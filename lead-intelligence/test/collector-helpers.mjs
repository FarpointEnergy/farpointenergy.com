import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.mjs';
export function testConfig(overrides = {}) {
  return { ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test@localhost/test',
    ADMIN_TOKEN: 'synthetic-test-admin-token-000000000000', NETWORK_HMAC_KEY: 'synthetic-test-network-key-00000000000', DELETION_HMAC_KEY: 'synthetic-test-deletion-key-0000000000',
    UMAMI_URL: 'http://127.0.0.1:3000', UMAMI_WEBSITE_ID: '11111111-1111-4111-8111-111111111111', UMAMI_QA_WEBSITE_ID: '22222222-2222-4222-8222-222222222222' }), ...overrides };
}
export function event(overrides = {}) {
  return { schemaVersion: 1, eventId: randomUUID(), browserId: randomUUID(), sessionId: randomUUID(), name: 'page_view', page: '/index.html',
    product: 'unsure', application: 'unsure', campaignCode: '', source: '', medium: '', referrerHost: '', language: 'en', screenClass: 'desktop', clientTimestamp: Date.now(), ...overrides };
}
