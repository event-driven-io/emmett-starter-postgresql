import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { EventStoreDBClient } from '@eventstore/db-client';
import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { guestStayAccountsApi } from './guestStayAccounts/api/api';

const eventStoreDBClient = EventStoreDBClient.connectionString(
  process.env.ESDB_CONNECTION_STRING ?? `esdb://localhost:2113?tls=false`,
);
const eventStore = getEventStoreDBEventStore(eventStoreDBClient);

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
