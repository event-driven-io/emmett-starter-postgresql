import {
  formatDateToUtcYYYYMMDD,
  getInMemoryEventStore,
  type EventStore,
  type TestEventStream,
} from '@event-driven-io/emmett';
import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import {
  toGuestStayAccountId,
  type GuestStayAccountEvent,
} from '../guestStayAccount';
import { guestStayAccountsApi } from './api';

const doesGuestStayExist = (_guestId: string, _roomId: string, _day: Date) =>
  Promise.resolve(true);

void describe('Guest stay account', () => {
  const oldTime = new Date();
  const now = new Date();
  const formattedNow = formatDateToUtcYYYYMMDD(now);

  let guestId: string;
  let roomId: string;
  let guestStayAccountId: string;
  const amount = Math.random() * 100;
  const transactionId = randomUUID();

  beforeEach(() => {
    guestId = randomUUID();
    roomId = randomUUID();
    guestStayAccountId = toGuestStayAccountId(guestId, roomId, now);
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
    const notExistingAccount: TestEventStream<GuestStayAccountEvent>[] = [];

    void it('checks in', () =>
      given(...notExistingAccount)
        .when(checkIn)
        .then([
          expectResponse(201),
          expectNewEvents(guestStayAccountId, [
            {
              type: 'GuestCheckedIn',
              data: {
                guestStayAccountId,
                guestId,
                roomId,
                checkedInAt: now,
              },
            },
          ]),
        ]));

    void it(`doesn't record charge`, () =>
      given(...notExistingAccount)
        .when(recordCharge)
        .then(
          expectError(403, {
            detail: `Guest account doesn't exist!`,
          }),
        ));

    void it(`doesn't record payment`, () =>
      given(...notExistingAccount)
        .when(recordPayment)
        .then(
          expectError(403, {
            detail: `Guest account doesn't exist!`,
          }),
        ));

    void it(`doesn't checkout`, () =>
      given(...notExistingAccount)
        .when(checkOut)
        .then(expectError(403)));
  });

  void describe('When checked in', () => {
    let checkedInAccount: TestEventStream<GuestStayAccountEvent>;

    beforeEach(
      () =>
        (checkedInAccount = existingStream(guestStayAccountId, [
          {
            type: 'GuestCheckedIn',
            data: {
              guestStayAccountId,
              guestId,
              roomId,
              checkedInAt: oldTime,
            },
          },
        ])),
    );

    void it(`doesn't check in`, () =>
      given(checkedInAccount)
        .when(checkIn)
        .then(expectError(403, { detail: `Guest is already checked-in!` })));

    void it('records charge', () =>
      given(checkedInAccount)
        .when(recordCharge)
        .then([
          expectResponse(204),
          expectNewEvents(guestStayAccountId, [
            {
              type: 'ChargeRecorded',
              data: {
                chargeId: `charge-${transactionId}`,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]),
        ]));

    void it('records payment', () =>
      given(checkedInAccount)
        .when(recordPayment)
        .then([
          expectResponse(204),
          expectNewEvents(guestStayAccountId, [
            {
              type: 'PaymentRecorded',
              data: {
                paymentId: `payment-${transactionId}`,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]),
        ]));

    void it('checks out', () =>
      given(checkedInAccount)
        .when(checkOut)
        .then([
          expectResponse(204),
          expectNewEvents(guestStayAccountId, [
            {
              type: 'GuestCheckedOut',
              data: {
                guestStayAccountId,
                checkedOutAt: now,
                groupCheckoutId: undefined,
              },
            },
          ]),
        ]));

    void describe('with unsettled balance', () => {
      let unsettledAccount: TestEventStream<GuestStayAccountEvent>;

      beforeEach(
        () =>
          (unsettledAccount = existingStream(guestStayAccountId, [
            {
              type: 'GuestCheckedIn',
              data: {
                guestStayAccountId,
                guestId,
                roomId,
                checkedInAt: oldTime,
              },
            },
            {
              type: 'ChargeRecorded',
              data: {
                chargeId: `charge-${randomUUID()}`,
                amount,
                guestStayAccountId,
                recordedAt: oldTime,
              },
            },
          ])),
      );

      void it('records charge', () =>
        given(unsettledAccount)
          .when(recordCharge)
          .then([
            expectResponse(204),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'ChargeRecorded',
                data: {
                  chargeId: `charge-${transactionId}`,
                  guestStayAccountId,
                  amount,
                  recordedAt: now,
                },
              },
            ]),
          ]));

      void it('records payment', () =>
        given(unsettledAccount)
          .when(recordPayment)
          .then([
            expectResponse(204),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'PaymentRecorded',
                data: {
                  paymentId: `payment-${transactionId}`,
                  guestStayAccountId,
                  amount,
                  recordedAt: now,
                },
              },
            ]),
          ]));

      void it(`doesn't check out`, () =>
        given(unsettledAccount)
          .when(checkOut)
          .then([
            expectError(403),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'GuestCheckoutFailed',
                data: {
                  guestStayAccountId,
                  reason: 'BalanceNotSettled',
                  groupCheckoutId: undefined,
                  failedAt: now,
                },
              },
            ]),
          ]));
    });

    void describe('with settled balance', () => {
      let settledAccount: TestEventStream<GuestStayAccountEvent>;

      beforeEach(
        () =>
          (settledAccount = existingStream(guestStayAccountId, [
            {
              type: 'GuestCheckedIn',
              data: {
                guestStayAccountId,
                guestId,
                roomId,
                checkedInAt: oldTime,
              },
            },
            {
              type: 'ChargeRecorded',
              data: {
                chargeId: `charge-${randomUUID()}`,
                amount,
                guestStayAccountId,
                recordedAt: oldTime,
              },
            },
            {
              type: 'PaymentRecorded',
              data: {
                paymentId: `payment-${randomUUID()}`,
                amount,
                guestStayAccountId,
                recordedAt: oldTime,
              },
            },
          ])),
      );

      void it('records charge', () =>
        given(settledAccount)
          .when(recordCharge)
          .then([
            expectResponse(204),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'ChargeRecorded',
                data: {
                  chargeId: `charge-${transactionId}`,
                  guestStayAccountId,
                  amount,
                  recordedAt: now,
                },
              },
            ]),
          ]));

      void it('records payment', () =>
        given(settledAccount)
          .when(recordPayment)
          .then([
            expectResponse(204),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'PaymentRecorded',
                data: {
                  paymentId: `payment-${transactionId}`,
                  guestStayAccountId,
                  amount,
                  recordedAt: now,
                },
              },
            ]),
          ]));

      void it(`checks out`, () =>
        given(settledAccount)
          .when(checkOut)
          .then([
            expectResponse(204),
            expectNewEvents(guestStayAccountId, [
              {
                type: 'GuestCheckedOut',
                data: {
                  guestStayAccountId,
                  checkedOutAt: now,
                  groupCheckoutId: undefined,
                },
              },
            ]),
          ]));
    });
  });

  void describe('When checked out', () => {
    let checkedOutAccount: TestEventStream<GuestStayAccountEvent>;

    beforeEach(
      () =>
        (checkedOutAccount = existingStream(guestStayAccountId, [
          {
            type: 'GuestCheckedIn',
            data: {
              guestStayAccountId,
              guestId,
              roomId,
              checkedInAt: oldTime,
            },
          },
          {
            type: 'ChargeRecorded',
            data: {
              chargeId: `charge-${randomUUID()}`,
              amount,
              guestStayAccountId,
              recordedAt: oldTime,
            },
          },
          {
            type: 'PaymentRecorded',
            data: {
              paymentId: `payment-${randomUUID()}`,
              amount,
              guestStayAccountId,
              recordedAt: oldTime,
            },
          },
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId,
              groupCheckoutId: undefined,
              checkedOutAt: now,
            },
          },
        ])),
    );

    void it(`doesn't check in`, () =>
      given(checkedOutAccount)
        .when(checkIn)
        .then(
          expectError(403, { detail: `Guest account is already checked out` }),
        ));

    void it(`doesn't record charge`, () =>
      given(checkedOutAccount)
        .when(recordCharge)
        .then(
          expectError(403, { detail: `Guest account is already checked out` }),
        ));

    void it(`doesn't record payment`, () =>
      given(checkedOutAccount)
        .when(recordPayment)
        .then(
          expectError(403, { detail: `Guest account is already checked out` }),
        ));

    void it(`doesn't checkout`, () =>
      given(checkedOutAccount)
        .when(checkOut)
        .then([
          expectError(403, { detail: `NotCheckedIn` }),
          expectNewEvents(guestStayAccountId, [
            {
              type: 'GuestCheckoutFailed',
              data: {
                guestStayAccountId,
                groupCheckoutId: undefined,
                reason: 'NotCheckedIn',
                failedAt: now,
              },
            },
          ]),
        ]));
  });

  const given = ApiSpecification.for<GuestStayAccountEvent>(
    (): EventStore => getInMemoryEventStore(),
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
