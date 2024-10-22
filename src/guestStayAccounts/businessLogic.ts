import { IllegalStateError, type Command } from '@event-driven-io/emmett';
import {
  toGuestStayAccountId,
  type ChargeRecorded,
  type CheckedIn,
  type GuestCheckedIn,
  type GuestCheckedOut,
  type GuestCheckoutFailed,
  type GuestStayAccount,
  type GuestStayAccountEvent,
  type PaymentRecorded,
} from './guestStayAccount';

export type CheckIn = Command<
  'CheckIn',
  {
    guestId: string;
    roomId: string;
  }
>;

export type RecordCharge = Command<
  'RecordCharge',
  {
    chargeId: string;
    guestStayAccountId: string;
    amount: number;
  }
>;

export type RecordPayment = Command<
  'RecordPayment',
  {
    paymentId: string;
    guestStayAccountId: string;
    amount: number;
  }
>;

export type CheckOut = Command<
  'CheckOut',
  {
    guestStayAccountId: string;
    groupCheckoutId?: string;
  }
>;

export type GuestStayCommand =
  | CheckIn
  | RecordCharge
  | RecordPayment
  | CheckOut;

export const checkIn = (
  { data: { guestId, roomId }, metadata }: CheckIn,
  state: GuestStayAccount,
): GuestCheckedIn => {
  assertDoesNotExist(state);

  const now = metadata?.now ?? new Date();

  return {
    type: 'GuestCheckedIn',
    data: {
      guestId,
      roomId,
      guestStayAccountId: toGuestStayAccountId(guestId, roomId, now),
      checkedInAt: now,
    },
  };
};

export const recordCharge = (
  { data: { guestStayAccountId, chargeId, amount }, metadata }: RecordCharge,
  state: GuestStayAccount,
): ChargeRecorded => {
  assertIsCheckedIn(state);

  return {
    type: 'ChargeRecorded',
    data: {
      chargeId,
      guestStayAccountId,
      amount: amount,
      recordedAt: metadata?.now ?? new Date(),
    },
  };
};

export const recordPayment = (
  { data: { guestStayAccountId, paymentId, amount }, metadata }: RecordPayment,
  state: GuestStayAccount,
): PaymentRecorded => {
  assertIsCheckedIn(state);

  return {
    type: 'PaymentRecorded',
    data: {
      paymentId,
      guestStayAccountId,
      amount: amount,
      recordedAt: metadata?.now ?? new Date(),
    },
  };
};

export const checkOut = (
  { data: { guestStayAccountId, groupCheckoutId }, metadata }: CheckOut,
  state: GuestStayAccount,
): GuestCheckedOut | GuestCheckoutFailed => {
  const now = metadata?.now ?? new Date();

  if (state.status !== 'CheckedIn')
    return {
      type: 'GuestCheckoutFailed',
      data: {
        guestStayAccountId,
        groupCheckoutId,
        reason: 'NotCheckedIn',
        failedAt: now,
      },
    };

  const isSettled = state.balance === 0;

  return isSettled
    ? {
        type: 'GuestCheckedOut',
        data: {
          guestStayAccountId,
          groupCheckoutId,
          checkedOutAt: now,
        },
      }
    : {
        type: 'GuestCheckoutFailed',
        data: {
          guestStayAccountId,
          groupCheckoutId,
          reason: 'BalanceNotSettled',
          failedAt: now,
        },
      };
};

export const decide = (
  command: GuestStayCommand,
  state: GuestStayAccount,
): GuestStayAccountEvent => {
  const { type } = command;

  switch (type) {
    case 'CheckIn':
      return checkIn(command, state);
    case 'RecordCharge':
      return recordCharge(command, state);
    case 'RecordPayment':
      return recordPayment(command, state);
    case 'CheckOut':
      return checkOut(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new Error(`Unknown command type`);
    }
  }
};

const assertDoesNotExist = (state: GuestStayAccount): state is CheckedIn => {
  if (state.status === 'CheckedIn')
    throw new IllegalStateError(`Guest is already checked-in!`);

  if (state.status === 'CheckedOut')
    throw new IllegalStateError(`Guest account is already checked out`);

  return true;
};

const assertIsCheckedIn = (state: GuestStayAccount): state is CheckedIn => {
  if (state.status === 'NotExisting')
    throw new IllegalStateError(`Guest account doesn't exist!`);

  if (state.status === 'CheckedOut')
    throw new IllegalStateError(`Guest account is already checked out`);

  return true;
};
