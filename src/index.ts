import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { guestStayAccountsApi } from './guestStayAccounts/api/api';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres@localhost:5432/postgres';

const eventStore = getPostgreSQLEventStore(connectionString);

const doesGuestStayExist = (_guestId: string, _roomId: string, _day: Date) =>
  Promise.resolve(true);

const guestStayAccounts = guestStayAccountsApi(
  eventStore,
  doesGuestStayExist,
  (prefix) => `${prefix}-${randomUUID()}`,
  () => new Date(),
);

const application: Application = getApplication({
  apis: [guestStayAccounts],
});

startAPI(application);
