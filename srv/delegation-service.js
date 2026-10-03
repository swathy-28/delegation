'use strict';

const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;

module.exports = cds.service.impl(async function () {
  const { Delegations } = this.entities;
  const resolveUser = (req) => {
    const user = req.user;
    if (!user) {
      req.reject(401, 'No authenticated user on the request');
      return;
    }
    const rawEmail = user.attr?.email || user.id;
    const email = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
    if (!email) {
      req.reject(401, 'No authenticated user on the request');
      return;
    }
    return { id: user.id, email };
  };
  this.before('CREATE', Delegations, (req) => {
    const resolved = resolveUser(req);
    if (!resolved) return;

    if (!req.data.delegator) {
      req.data.delegator = resolved.email;
    }
    // createdBy always mirrors delegator exactly (per schema.cds), stamped
    // server-side so it's consistent whether the record was created via
    // "My Delegation" (delegator = caller) or "Admin Delegation" (delegator
    // = whoever the admin picked) — never left blank waiting on the client.
    req.data.createdBy = req.data.delegator;
    req.data.isActive = req.data.isActive ?? true;

    const { validFrom, validTo, delegateUser, application } = req.data;
    if (!delegateUser) req.error(400, 'Delegate User is required.');
    if (!application) req.error(400, 'Application is required.');
    if (validFrom && validTo && validTo < validFrom) {
      req.error(400, 'Valid To must be on/after Valid From.');
    }
    // createdAt/updatedAt stamped by @cds.on.insert:$now on both fields — no manual set needed here
  });

  this.before('UPDATE', Delegations, (req) => {
    if (req.data.validFrom && req.data.validTo) {
      if (req.data.validTo < req.data.validFrom) {
        req.error(400, 'Valid To must be on/after Valid From.');
      }
    }

    // Explicitly stamp updatedAt on every edit — do not rely solely on the
    // @cds.on.update annotation, since bound actions below issue raw
    // UPDATE queries that must set this themselves too.
    req.data.updatedAt = new Date().toISOString();
  });

  this.after(['READ'], Delegations, (data) => {
    const rows = Array.isArray(data) ? data : [data];
    const today = new Date().toISOString().slice(0, 10);

    rows.forEach((row) => {
      if (!row) return;

      if (row.isActive === false) {
        row.status = 'Inactive';
      } else if (row.validFrom > today) {
        row.status = 'Future';
      } else if (row.validTo < today) {
        row.status = 'Expired';
      } else {
        row.status = 'Active';
      }
    });
  });

  // Bound action: Activate — now also stamps updatedAt since this is a raw
  // UPDATE that bypasses the standard managed-field annotation pipeline.
  this.on('activate', Delegations, async (req) => {
    const id = req.params[0].ID;
    await UPDATE(Delegations)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where({ ID: id });
    return await SELECT.one.from(Delegations).where({ ID: id });
  });

  // Bound action: Deactivate — same fix.
  this.on('deactivate', Delegations, async (req) => {
    const id = req.params[0].ID;
    await UPDATE(Delegations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where({ ID: id });
    return await SELECT.one.from(Delegations).where({ ID: id });
  });

  this.on('getCurrentUser', async (req) => {
    const resolved = resolveUser(req);
    if (!resolved) return;
    return resolved;
  });
});