import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMetricsServer } from './metrics-server.js';
import { Server } from 'node:http';
import { request } from 'node:http';

describe('Metrics Server', () => {
  let server: Server;
  let port: number;

  before(async () => {
    server = startMetricsServer(0); // bind to 0 to get an ephemeral port
    await new Promise<void>((resolve) => {
      server.on('listening', () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  const getUrl = (path: string) => {
    return new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode!, data });
        });
      });
      req.on('error', reject);
      req.end();
    });
  };

  test('GET /metrics returns 200', async () => {
    const { statusCode, data } = await getUrl('/metrics');
    assert.equal(statusCode, 200);
    assert.ok(data.includes('organator_data_isolation_reconciliations_total'));
  });

  test('GET /unknown returns 404', async () => {
    const { statusCode } = await getUrl('/unknown');
    assert.equal(statusCode, 404);
  });
});
