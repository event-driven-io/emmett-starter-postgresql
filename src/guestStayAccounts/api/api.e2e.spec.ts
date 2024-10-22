import {
  formatDateToUtcYYYYMMDD,
  type EventStore,
} from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import {
  ApiE2ESpecification,
  expectError,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
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

  let esdbContainer: StartedEventStoreDBContainer;
  let given: ApiE2ESpecification;

  before(async () => {
    esdbContainer = await new EventStoreDBContainer().start();

    given = ApiE2ESpecification.for(
      (): EventStore => getEventStoreDBEventStore(esdbContainer.getClient()),
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            guestStayAccountsApi(
              eventStore,
              doesGuestStayExist,
              (prefix) => `${prefix}-${transactionId}`,
              () => now,
            ),
          ],
        }),
    );
  });

  after(() => {
    return esdbContainer.stop();
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
  });

  void describe('When checked in', () => {
    const checkedInAccount: TestRequest = checkIn;

    void it(`doesn't check in`, () =>
      given(checkedInAccount)
        .when(checkIn)
        .then([expectError(403, { detail: `Guest is already checked-in!` })]));

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

    void it(`doesn't checkout`, () =>
      given(...checkedOutAccount)
        .when(checkOut)
        .then([expectError(403, { detail: `NotCheckedIn` })]));
  });
});
