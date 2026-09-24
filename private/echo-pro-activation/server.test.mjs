import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExplicitActivationReplacement,
  findActivationForDeviceRelease,
  findActiveOrderActivationByHwid,
  selectOrderActivationsForSelfUnbind,
} from './server.mjs';

const orderEntry = {
  activations: [
    { qq: '10001', machineCodeHash: 'hwid-a', revoked: true },
    { qq: '10001', machineCodeHash: 'hwid-b', revoked: false },
    { qq: '20002', machineCodeHash: 'hwid-c', revoked: false },
  ],
};

test('reuses an active HWID even when the submitted QQ changes', () => {
  assert.equal(
    findActiveOrderActivationByHwid(orderEntry, 'hwid-c'),
    orderEntry.activations[2],
  );
  assert.equal(findActiveOrderActivationByHwid(orderEntry, 'hwid-a'), null);
});

test('order number alone releases every active HWID for the order', () => {
  assert.deepEqual(
    selectOrderActivationsForSelfUnbind(orderEntry),
    [orderEntry.activations[1], orderEntry.activations[2]],
  );
});

test('order self-unbind is idempotent after every HWID is revoked', () => {
  assert.deepEqual(selectOrderActivationsForSelfUnbind({
    activations: orderEntry.activations.map((record) => ({ ...record, revoked: true })),
  }), []);
});

test('current-device release requires all three signed device identifiers', () => {
  const state = {
    activations: {
      order_123456: {
        activations: [
          {
            licenseId: 'lic_0123456789abcdef',
            activationId: 'act_0123456789abcdef',
            machineCodeHash: 'a'.repeat(64),
            revoked: false,
          },
        ],
      },
    },
  };
  assert.equal(findActivationForDeviceRelease(state, {
    licenseId: 'lic_0123456789abcdef',
    activationId: 'act_0123456789abcdef',
    machineCodeHash: 'a'.repeat(64),
  })?.orderId, 'order_123456');
  assert.equal(findActivationForDeviceRelease(state, {
    licenseId: 'lic_0123456789abcdef',
    activationId: 'act_0123456789abcdef',
    machineCodeHash: 'b'.repeat(64),
  }), null);
});

test('identity migration replaces only the explicitly proven active activation for the same QQ', () => {
  const order = {
    activations: [
      {
        qq: '10001',
        licenseId: 'lic_0123456789abcdef',
        activationId: 'act_0123456789abcdef',
        revoked: false,
      },
      {
        qq: '20002',
        licenseId: 'lic_fedcba9876543210',
        activationId: 'act_fedcba9876543210',
        revoked: false,
      },
    ],
  };
  assert.equal(findExplicitActivationReplacement(order, {
    qq: '10001',
    replaceLicenseId: 'lic_0123456789abcdef',
    replaceActivationId: 'act_0123456789abcdef',
  }), null);
  assert.equal(findExplicitActivationReplacement(order, {
    qq: '10001',
    replaceMachineBinding: true,
    replaceLicenseId: 'lic_0123456789abcdef',
    replaceActivationId: 'act_0123456789abcdef',
  }), order.activations[0]);
  assert.equal(findExplicitActivationReplacement(order, {
    qq: '20002',
    replaceMachineBinding: true,
    replaceLicenseId: 'lic_0123456789abcdef',
    replaceActivationId: 'act_0123456789abcdef',
  }), null);
  assert.equal(findExplicitActivationReplacement(order, {
    qq: '10001',
    replaceMachineBinding: true,
    replaceLicenseId: 'lic_0123456789abcdef',
    replaceActivationId: 'act_fedcba9876543210',
  }), null);
});
