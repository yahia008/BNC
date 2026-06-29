import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { getCursor, saveCursor, upsertInvoice } from './db';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.INVOICE_CONTRACT_ID || 'C_MOCK_INVOICE_CONTRACT_ID'; // Replace with real one

const server = new rpc.Server(RPC_URL);

export async function pollEvents() {
  logger.info({ contract_id: CONTRACT_ID }, 'Started polling Horizon for contract events...');

  let cursor = (await getCursor()) || '';

  // Polling loop
  setInterval(async () => {
    try {
      // Soroban getEvents requests
      const request: rpc.Api.GetEventsRequest = cursor
        ? {
            cursor,
            filters: [
              {
                type: 'contract',
                contractIds: [CONTRACT_ID],
                topics: [['*']]
              }
            ],
            limit: 100
          }
        : {
            startLedger: await getLatestLedger(),
            filters: [
              {
                type: 'contract',
                contractIds: [CONTRACT_ID],
                topics: [['*']]
              }
            ],
            limit: 100
          };

      const response = await server.getEvents(request);

      if (response.events && response.events.length > 0) {
        for (const event of response.events) {
          processEvent(event);
        }
        cursor = response.cursor;
        await saveCursor(cursor);
      }
    } catch (err) {
      logger.error({ err }, 'Error fetching events');
    }
  }, 5000); // Poll every 5 seconds
}

async function getLatestLedger(): Promise<number> {
  try {
    const health = await server.getLatestLedger();
    return health.sequence;
  } catch (err) {
    logger.error({ err }, 'Could not get latest ledger');
    return 1;
  }
}

export function processEvent(event: rpc.Api.EventResponse) {
  // Topics are scVals, typically symbol strings
  const topics = event.topic.map(t => {
    try {
      return scValToNative(t);
    } catch {
      return null;
    }
  });

  const eventType = topics[0]; // e.g. 'submitted', 'funded', 'paid', 'defaulted'
  if (!eventType) return;

  try {
    const data = scValToNative(event.value);
    
    // Assume data contains { id, freelancer, payer, amount, dueDate } for 'submitted'
    // and just { id } for status changes. This is dependent on contract implementation.
    
    if (eventType === 'submitted') {
      upsertInvoice({
        id: data.id,
        freelancer: data.freelancer || '',
        payer: data.payer || '',
        amount: data.amount || 0,
        due_date: data.dueDate || new Date().toISOString(),
        status: 'Pending'
      });
      logger.info({ event_type: eventType, contract_id: CONTRACT_ID, ledger_sequence: event.ledger, invoice_id: data.id }, 'Processed submitted event');
    } else if (eventType === 'funded') {
      upsertInvoice({
        id: data.id || data,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Funded'
      });
      logger.info({ event_type: eventType, contract_id: CONTRACT_ID, ledger_sequence: event.ledger, invoice_id: data.id || data }, 'Processed funded event');
    } else if (eventType === 'paid') {
      upsertInvoice({
        id: data.id || data,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Paid'
      });
      logger.info({ event_type: eventType, contract_id: CONTRACT_ID, ledger_sequence: event.ledger, invoice_id: data.id || data }, 'Processed paid event');
    } else if (eventType === 'defaulted') {
      upsertInvoice({
        id: data.id || data,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Defaulted'
      });
      logger.info({ event_type: eventType, contract_id: CONTRACT_ID, ledger_sequence: event.ledger, invoice_id: data.id || data }, 'Processed defaulted event');
    }
  } catch (err) {
    logger.error({ err, event_type: eventType, contract_id: CONTRACT_ID, ledger_sequence: event.ledger, event_id: event.id }, 'Failed to process event');
  }
}
