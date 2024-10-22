import {
  CommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  formatDateToUtcYYYYMMDD,
  parseDateFromUtcYYYYMMDD,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  Created,
  Forbidden,
  NoContent,
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import { type Request, type Router } from 'express';
import {
  checkIn,
  checkOut,
  recordCharge,
  recordPayment,
  type CheckIn,
  type CheckOut,
  type RecordCharge,
  type RecordPayment,
} from '../businessLogic';
import {
  evolve,
  initialState,
  toGuestStayAccountId,
} from '../guestStayAccount';
import { getGuestStayDetails } from '../guestStayDetails';

export const handle = CommandHandler({ evolve, initialState });

type CheckInRequest = Request<Partial<{ guestId: string; roomId: string }>>;

type RecordChargeRequest = Request<
  Partial<{ guestId: string; roomId: string; checkInDate: string }>,
  unknown,
  Partial<{ amount: number }>
>;

type RecordPaymentRequest = Request<
  Partial<{ guestId: string; roomId: string; checkInDate: string }>,
  unknown,
  Partial<{ amount: number }>
>;

type CheckOutRequest = Request<
  Partial<{ guestId: string; roomId: string; checkInDate: string }>,
  unknown,
  unknown
>;

type GetGuestStayAccountDetailsRequest = Request<
  Partial<{ guestId: string; roomId: string; checkInDate: string }>,
  unknown,
  unknown
>;

export const guestStayAccountsApi =
  (
    eventStore: EventStore,
    doesGuestStayExist: (
      guestId: string,
      roomId: string,
      day: Date,
    ) => Promise<boolean>,
    generateId: (prefix: string) => string,
    getCurrentTime: () => Date,
  ): WebApiSetup =>
  (router: Router) => {
    // Check In
    router.post(
      '/guests/:guestId/stays/:roomId',
      on(async (request: CheckInRequest) => {
        const guestId = assertNotEmptyString(request.params.guestId);
        const roomId = assertNotEmptyString(request.params.roomId);
        const now = getCurrentTime();

        if (!(await doesGuestStayExist(guestId, roomId, now)))
          return Forbidden();

        const guestStayAccountId = toGuestStayAccountId(guestId, roomId, now);

        const command: CheckIn = {
          type: 'CheckIn',
          data: {
            guestId,
            roomId,
          },
          metadata: { now },
        };

        await handle(eventStore, guestStayAccountId, (state) =>
          checkIn(command, state),
        );

        return Created({
          url: `/guests/${guestId}/stays/${roomId}/periods/${formatDateToUtcYYYYMMDD(now)}`,
        });
      }),
    );

    // Record Charge
    router.post(
      '/guests/:guestId/stays/:roomId/periods/:checkInDate/charges',
      on(async (request: RecordChargeRequest) => {
        const guestStayAccountId = parseGuestStayAccountId(request.params);

        const command: RecordCharge = {
          type: 'RecordCharge',
          data: {
            chargeId: generateId('charge'),
            guestStayAccountId,
            amount: assertPositiveNumber(Number(request.body.amount)),
          },
          metadata: { now: getCurrentTime() },
        };

        await handle(eventStore, guestStayAccountId, (state) =>
          recordCharge(command, state),
        );

        return NoContent();
      }),
    );

    // Record Payment
    router.post(
      '/guests/:guestId/stays/:roomId/periods/:checkInDate/payments',
      on(async (request: RecordPaymentRequest) => {
        const guestStayAccountId = parseGuestStayAccountId(request.params);

        const command: RecordPayment = {
          type: 'RecordPayment',
          data: {
            paymentId: generateId('payment'),
            guestStayAccountId,
            amount: assertPositiveNumber(Number(request.body.amount)),
          },
          metadata: { now: getCurrentTime() },
        };

        await handle(eventStore, guestStayAccountId, (state) =>
          recordPayment(command, state),
        );

        return NoContent();
      }),
    );

    // CheckOut Guest
    router.delete(
      '/guests/:guestId/stays/:roomId/periods/:checkInDate',
      on(async (request: CheckOutRequest) => {
        const guestStayAccountId = parseGuestStayAccountId(request.params);

        const command: CheckOut = {
          type: 'CheckOut',
          data: { guestStayAccountId },
          metadata: { now: getCurrentTime() },
        };

        const {
          newEvents: [event],
        } = await handle(eventStore, guestStayAccountId, (state) =>
          checkOut(command, state),
        );

        return event.type !== 'GuestCheckoutFailed'
          ? NoContent()
          : Forbidden({
              problemDetails: event.data.reason,
            });
      }),
    );

    // Get Guest Stay Account Details
    router.get(
      '/guests/:guestId/stays/:roomId/periods/:checkInDate',
      on(async (request: GetGuestStayAccountDetailsRequest) => {
        const guestStayAccountId = parseGuestStayAccountId(request.params);

        const result = await getGuestStayDetails(
          eventStore,
          guestStayAccountId,
        );

        if (result === null) return NotFound();

        if (result.state.status !== 'CheckedIn') return NotFound();

        return OK({
          body: result.state,
        });
      }),
    );
  };

const parseGuestStayAccountId = ({
  guestId,
  roomId,
  checkInDate,
}: {
  guestId?: string;
  roomId?: string;
  checkInDate?: string;
}) =>
  toGuestStayAccountId(
    assertNotEmptyString(guestId),
    assertNotEmptyString(roomId),
    parseDateFromUtcYYYYMMDD(assertNotEmptyString(checkInDate)),
  );
