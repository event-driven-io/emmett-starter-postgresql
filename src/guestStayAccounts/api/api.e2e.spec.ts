import {
  formatDateToUtcYYYYMMDD,
  projections,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectError,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '@event-driven-io/emmett-postgresql';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { toGuestStayAccountId } from '../guestStayAccount';
import {
  guestStayDetailsProjection,
  type GuestStayDetails,
} from '../guestStayDetails';
import { guestStayAccountsApi } from './api';

const doesGuestStayExist = (_guestId: string, _roomId: string, _day: Date) =>
  Promise.resolve(true);

void describe('guestStayAccount E2E', () => {
  const now = new Date();
  const formattedNow = formatDateToUtcYYYYMMDD(now);

  let guestId: string;
  let roomId: string;
  const amount = Math.random() * 100;
  const transactionId = randomUUID();

  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;
  let readStore: PongoClient;
  let given: ApiE2ESpecification;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();

    const connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([guestStayDetailsProjection]),
    });
    readStore = pongoClient(connectionString);

    given = ApiE2ESpecification.for(
      (): EventStore => eventStore,
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            guestStayAccountsApi(
              eventStore,
              readStore.db(),
              doesGuestStayExist,
              (prefix) => `${prefix}-${transactionId}`,
              () => now,
            ),
          ],
        }),
    );
  });

  after(async () => {
    await eventStore.close();
    await readStore.close();
    await postgres.stop();
  });

  beforeEach(() => {
    guestId = randomUUID();
    roomId = randomUUID();
  });

  const checkIn: TestRequest = (request) =>
    request.post(`/guests/${guestId}/stays/${roomId}`);

  const recordCharge: TestRequest = (request) =>
    request
      .post(
        `/guests/${guestId}/stays/${roomId}/periods/${formattedNow}/charges`,
      )
      .send({ amount });

  const recordPayment: TestRequest = (request) =>
    request
      .post(
        `/guests/${guestId}/stays/${roomId}/periods/${formattedNow}/payments`,
      )
      .send({ amount });

  const checkOut: TestRequest = (request) =>
    request.delete(
      `/guests/${guestId}/stays/${roomId}/periods/${formattedNow}`,
    );
  const getDetails: TestRequest = (request) =>
    request.get(`/guests/${guestId}/stays/${roomId}/periods/${formattedNow}`);

  void describe('When not existing', () => {
    const notExistingAccount: TestRequest[] = [];

    void it('checks in', () =>
      given(...notExistingAccount)
        .when(checkIn)
        .then([expectResponse(201)]));

    void it(`doesn't record charge`, () =>
      given(...notExistingAccount)
        .when(recordCharge)
        .then([
          expectError(403, {
            detail: `Guest account doesn't exist!`,
          }),
        ]));

    void it(`doesn't record payment`, () =>
      given(...notExistingAccount)
        .when(recordPayment)
        .then([
          expectError(403, {
            detail: `Guest account doesn't exist!`,
          }),
        ]));

    void it(`doesn't checkout`, () =>
      given(...notExistingAccount)
        .when(checkOut)
        .then([expectError(403)]));

    void it(`details return 404`, () =>
      given(...notExistingAccount)
        .when(getDetails)
        .then([expectError(404)]));
  });

  void describe('When checked in', () => {
    const checkedInAccount: TestRequest = checkIn;

    void it(`ignores check in`, () =>
      given(checkedInAccount)
        .when(checkIn)
        .then([expectResponse(201)]));

    void it('records charge', () =>
      given(checkedInAccount)
        .when(recordCharge)
        .then([expectResponse(204)]));

    void it('records payment', () =>
      given(checkedInAccount)
        .when(recordPayment)
        .then([expectResponse(204)]));

    void it('checks out', () =>
      given(checkedInAccount)
        .when(checkOut)
        .then([expectResponse(204)]));

    void it(`details return checked in stay`, () =>
      given(checkedInAccount)
        .when(getDetails)
        .then([
          expectResponse<GuestStayDetails>(200, {
            body: {
              _id: toGuestStayAccountId(guestId, roomId, now),
              status: 'CheckedIn',
              balance: 0,
              roomId,
              guestId,
              transactions: [],
              transactionsCount: 0,
              checkedInAt: now,
            },
          }),
        ]));

    void describe('with unsettled balance', () => {
      const unsettledAccount: TestRequest[] = [checkIn, recordCharge];

      void it('records charge', () =>
        given(...unsettledAccount)
          .when((request) =>
            request
              .post(
                `/guests/${guestId}/stays/${roomId}/periods/${formattedNow}/charges`,
              )
              .send({ amount }),
          )
          .then([expectResponse(204)]));

      void it('records payment', () =>
        given(...unsettledAccount)
          .when(recordPayment)
          .then([expectResponse(204)]));

      void it(`doesn't check out`, () =>
        given(...unsettledAccount)
          .when(checkOut)
          .then([expectError(403)]));

      void it(`details return checked in stay with charge`, () =>
        given(...unsettledAccount)
          .when(getDetails)
          .then([
            expectResponse(200, {
              body: {
                _id: toGuestStayAccountId(guestId, roomId, now),
                status: 'CheckedIn',
                balance: -amount,
                roomId,
                guestId,
                transactions: [{ amount }],
                transactionsCount: 1,
                checkedInAt: now,
              },
            }),
          ]));
    });

    void describe('with settled balance', () => {
      const settledAccount: TestRequest[] = [
        checkIn,
        recordCharge,
        recordPayment,
      ];

      void it('records charge', () =>
        given(...settledAccount)
          .when(recordCharge)
          .then([expectResponse(204)]));

      void it('records payment', () =>
        given(...settledAccount)
          .when(recordPayment)
          .then([expectResponse(204)]));

      void it(`checks out`, () =>
        given(...settledAccount)
          .when(checkOut)
          .then([expectResponse(204)]));

      void it(`details return checked in stay with charge`, () =>
        given(...settledAccount)
          .when(getDetails)
          .then([
            expectResponse(200, {
              body: {
                _id: toGuestStayAccountId(guestId, roomId, now),
                status: 'CheckedIn',
                balance: 0,
                roomId,
                guestId,
                transactions: [{ amount }, { amount }],
                transactionsCount: 2,
                checkedInAt: now,
              },
            }),
          ]));
    });
  });

  void describe('When checked out', () => {
    const checkedOutAccount: TestRequest[] = [
      checkIn,
      recordCharge,
      recordPayment,
      checkOut,
    ];

    void it(`doesn't check in`, () =>
      given(...checkedOutAccount)
        .when(checkIn)
        .then([
          expectError(403, { detail: `Guest account is already checked out` }),
        ]));

    void it(`doesn't record charge`, () =>
      given(...checkedOutAccount)
        .when(recordCharge)
        .then([
          expectError(403, { detail: `Guest account is already checked out` }),
        ]));

    void it(`doesn't record payment`, () =>
      given(...checkedOutAccount)
        .when(recordPayment)
        .then([
          expectError(403, { detail: `Guest account is already checked out` }),
        ]));

    void it(`ignores checkout`, () =>
      given(...checkedOutAccount)
        .when(checkOut)
        .then([expectResponse(204)]));

    void it(`details return 404`, () =>
      given(...checkedOutAccount)
        .when(getDetails)
        .then([expectResponse(404)]));
  });
});
