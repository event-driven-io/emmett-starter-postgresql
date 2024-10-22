import {
  DeciderSpecification,
  IllegalStateError,
} from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { decide } from './businessLogic';
import {
  evolve,
  initialState,
  toGuestStayAccountId,
  type GuestStayAccountEvent,
} from './guestStayAccount';

const given = DeciderSpecification.for({
  decide,
  evolve,
  initialState,
});

void describe('Guest Stay Account', () => {
  const oldTime = new Date();
  const now = new Date();

  const guestId = randomUUID();
  const roomId = randomUUID();
  const guestStayAccountId = toGuestStayAccountId(guestId, roomId, now);
  const amount = Math.random() * 100;
  const chargeId = randomUUID();
  const nextChargeId = randomUUID();
  const paymentId = randomUUID();
  const nextPaymentId = randomUUID();

  void describe('When not existing', () => {
    const notExistingAccount: GuestStayAccountEvent[] = [];

    void it('checks in', () =>
      given(notExistingAccount)
        .when({
          type: 'CheckIn',
          data: {
            guestId,
            roomId,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'GuestCheckedIn',
            data: {
              guestStayAccountId,
              guestId,
              roomId,
              checkedInAt: now,
            },
          },
        ]));

    void it(`doesn't record charge`, () =>
      given(notExistingAccount)
        .when({
          type: 'RecordCharge',
          data: {
            chargeId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest account doesn't exist!`,
        ));

    void it(`doesn't record payment`, () =>
      given(notExistingAccount)
        .when({
          type: 'RecordPayment',
          data: {
            paymentId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest account doesn't exist!`,
        ));

    void it(`doesn't checkout`, () =>
      given(notExistingAccount)
        .when({
          type: 'CheckOut',
          data: {
            guestStayAccountId,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'GuestCheckoutFailed',
            data: {
              guestStayAccountId,
              groupCheckoutId: undefined,
              reason: 'NotCheckedIn',
              failedAt: now,
            },
          },
        ]));
  });

  void describe('When checked in', () => {
    const checkedInAccount: GuestStayAccountEvent[] = [
      {
        type: 'GuestCheckedIn',
        data: {
          guestStayAccountId,
          guestId,
          roomId,
          checkedInAt: oldTime,
        },
      },
    ];

    void it(`doesn't check in`, () =>
      given(checkedInAccount)
        .when({
          type: 'CheckIn',
          data: {
            guestId,
            roomId,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest is already checked-in!`,
        ));

    void it('records charge', () => {
      given(checkedInAccount)
        .when({
          type: 'RecordCharge',
          data: {
            chargeId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'ChargeRecorded',
            data: {
              chargeId,
              guestStayAccountId,
              amount,
              recordedAt: now,
            },
          },
        ]);
    });

    void it('records payment', () =>
      given(checkedInAccount)
        .when({
          type: 'RecordPayment',
          data: {
            paymentId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'PaymentRecorded',
            data: {
              paymentId,
              guestStayAccountId,
              amount,
              recordedAt: now,
            },
          },
        ]));

    void it('checks out', () =>
      given(checkedInAccount)
        .when({
          type: 'CheckOut',
          data: {
            guestStayAccountId,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId,
              checkedOutAt: now,
              groupCheckoutId: undefined,
            },
          },
        ]));

    void describe('with unsettled balance', () => {
      const unsettledAccount: GuestStayAccountEvent[] = [
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
            chargeId,
            amount,
            guestStayAccountId,
            recordedAt: oldTime,
          },
        },
      ];

      void it('records charge', () => {
        given(unsettledAccount)
          .when({
            type: 'RecordCharge',
            data: {
              chargeId: nextChargeId,
              guestStayAccountId,
              amount,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'ChargeRecorded',
              data: {
                chargeId: nextChargeId,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]);
      });

      void it('records payment', () =>
        given(unsettledAccount)
          .when({
            type: 'RecordPayment',
            data: {
              paymentId,
              guestStayAccountId,
              amount,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'PaymentRecorded',
              data: {
                paymentId,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]));

      void it(`doesn't check out`, () =>
        given(unsettledAccount)
          .when({
            type: 'CheckOut',
            data: {
              guestStayAccountId,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'GuestCheckoutFailed',
              data: {
                guestStayAccountId,
                reason: 'BalanceNotSettled',
                groupCheckoutId: undefined,
                failedAt: now,
              },
            },
          ]));
    });

    void describe('with settled balance', () => {
      const settledAccount: GuestStayAccountEvent[] = [
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
            chargeId,
            amount,
            guestStayAccountId,
            recordedAt: oldTime,
          },
        },
        {
          type: 'PaymentRecorded',
          data: {
            paymentId,
            amount,
            guestStayAccountId,
            recordedAt: oldTime,
          },
        },
      ];

      void it('records charge', () => {
        given(settledAccount)
          .when({
            type: 'RecordCharge',
            data: {
              chargeId: nextChargeId,
              guestStayAccountId,
              amount,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'ChargeRecorded',
              data: {
                chargeId: nextChargeId,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]);
      });

      void it('records payment', () =>
        given(settledAccount)
          .when({
            type: 'RecordPayment',
            data: {
              paymentId: nextPaymentId,
              guestStayAccountId,
              amount,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'PaymentRecorded',
              data: {
                paymentId: nextPaymentId,
                guestStayAccountId,
                amount,
                recordedAt: now,
              },
            },
          ]));

      void it(`checks out`, () =>
        given(settledAccount)
          .when({
            type: 'CheckOut',
            data: {
              guestStayAccountId,
            },
            metadata: { now },
          })
          .then([
            {
              type: 'GuestCheckedOut',
              data: {
                guestStayAccountId,
                groupCheckoutId: undefined,
                checkedOutAt: now,
              },
            },
          ]));
    });
  });

  void describe('When checked out', () => {
    const checkedOutAccount: GuestStayAccountEvent[] = [
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
          chargeId,
          amount,
          guestStayAccountId,
          recordedAt: oldTime,
        },
      },
      {
        type: 'PaymentRecorded',
        data: {
          paymentId,
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
    ];

    void it(`doesn't check in`, () =>
      given(checkedOutAccount)
        .when({
          type: 'CheckIn',
          data: {
            guestId,
            roomId,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest account is already checked out`,
        ));

    void it(`doesn't record charge`, () =>
      given(checkedOutAccount)
        .when({
          type: 'RecordCharge',
          data: {
            chargeId: nextChargeId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest account is already checked out`,
        ));

    void it(`doesn't record payment`, () =>
      given(checkedOutAccount)
        .when({
          type: 'RecordPayment',
          data: {
            paymentId: nextPaymentId,
            guestStayAccountId,
            amount,
          },
          metadata: { now },
        })
        .thenThrows<IllegalStateError>(
          (error) => error.message === `Guest account is already checked out`,
        ));

    void it(`doesn't checkout`, () =>
      given(checkedOutAccount)
        .when({
          type: 'CheckOut',
          data: {
            guestStayAccountId,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'GuestCheckoutFailed',
            data: {
              guestStayAccountId,
              groupCheckoutId: undefined,
              reason: 'NotCheckedIn',
              failedAt: now,
            },
          },
        ]));
  });
});
