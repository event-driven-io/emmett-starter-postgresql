import { type EventStore } from '@event-driven-io/emmett';
import type { GuestStayAccountEvent } from './guestStayAccount';

export type NotExisting = { status: 'NotExisting' };

export type CheckedIn = {
  id: string;
  guestId: string;
  roomId: string;
  status: 'CheckedIn' | 'CheckedOut';
  balance: number;
  transactionsCount: number;
  transactions: { id: string; amount: number }[];
  checkedInAt: Date;
  checkedOutAt?: Date;
};

export type GuestStayDetails = NotExisting | CheckedIn;

export const initialState = (): GuestStayDetails => ({
  status: 'NotExisting',
});

export const evolve = (
  state: GuestStayDetails,
  { type, data: event }: GuestStayAccountEvent,
): GuestStayDetails => {
  switch (type) {
    case 'GuestCheckedIn': {
      return state.status === 'NotExisting'
        ? {
            id: event.guestStayAccountId,
            guestId: event.guestId,
            roomId: event.roomId,
            status: 'CheckedIn',
            balance: 0,
            transactionsCount: 0,
            transactions: [],
            checkedInAt: event.checkedInAt,
          }
        : state;
    }
    case 'ChargeRecorded': {
      return state.status === 'CheckedIn'
        ? {
            ...state,
            balance: state.balance - event.amount,
            transactionsCount: state.transactionsCount + 1,
            transactions: [
              ...state.transactions,
              { id: event.chargeId, amount: event.amount },
            ],
          }
        : state;
    }
    case 'PaymentRecorded': {
      return state.status === 'CheckedIn'
        ? {
            ...state,
            balance: state.balance + event.amount,
            transactionsCount: state.transactionsCount + 1,
            transactions: [
              ...state.transactions,
              { id: event.paymentId, amount: event.amount },
            ],
          }
        : state;
    }
    case 'GuestCheckedOut': {
      return state.status === 'CheckedIn'
        ? {
            ...state,
            status: 'CheckedOut',
            checkedOutAt: event.checkedOutAt,
          }
        : state;
    }
    case 'GuestCheckoutFailed': {
      return state;
    }
    default: {
      const _notExistingEventType: never = type;
      return state;
    }
  }
};

export const getGuestStayDetails = (
  eventStore: EventStore,
  guestStayAccountId: string,
) =>
  eventStore.aggregateStream(guestStayAccountId, {
    evolve,
    initialState,
  });
