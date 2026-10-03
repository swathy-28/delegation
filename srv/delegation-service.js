'use strict';

const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;

module.exports = cds.service.impl(async function () {
  const { Delegations } = this.entities;

  const isAdmin = (req) => req.user.is('DelegationAdmin');

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

  // Non-admins may only touch rows where they are the delegator
  const assertOwner = async (req, ID) => {
    if (isAdmin(req)) return;
    const me = resolveUser(req);
    if (!me) return;
    const row = await SELECT.one.from(Delegations).columns('ID', 'delegator').where({ ID });
    if (!row) return req.reject(404, 'Delegation not found');
    if (String(row.delegator || '').trim().toLowerCase() !== me.email) {
      return req.reject(403, 'Not your delegation');
    }
  };

  // READ: non-admins only see their own rows
  this.before('READ', Delegations, (req) => {
    if (isAdmin(req)) return;
    const me = resolveUser(req);
    if (!me) return;
    req.query.where`lower(delegator) = ${me.email}`;
  });

  this.before('CREATE', Delegations, (req) => {
    const resolved = resolveUser(req);
    if (!resolved) return;

    if (!isAdmin(req)) {
      req.data.delegator = resolved.email;   // cannot create on behalf of someone else
      req.data.createdVia = 'SELF';
    } else {
      if (!req.data.delegator) req.data.delegator = resolved.email;
      if (!['SELF', 'ADMIN'].includes(req.data.createdVia)) req.data.createdVia = 'ADMIN';
    }
    req.data.delegator = String(req.data.delegator).trim().toLowerCase();

    req.data.createdBy = req.data.delegator;
    req.data.isActive = req.data.isActive ?? true;

    const { validFrom, validTo, delegateUser, application } = req.data;
    if (!delegateUser) req.error(400, 'Delegate User is required.');
    if (!application) req.error(400, 'Application is required.');
    if (validFrom && validTo && validTo < validFrom) {
      req.error(400, 'Valid To must be on/after Valid From.');
    }
  });

  this.before('UPDATE', Delegations, async (req) => {
    await assertOwner(req, req.data.ID ?? req.params?.[0]?.ID ?? req.params?.[0]);

    if (!isAdmin(req)) {
      delete req.data.delegator;     // users cannot reassign ownership
      delete req.data.createdVia;
    }
    delete req.data.createdBy;

    if (req.data.validFrom && req.data.validTo) {
      if (req.data.validTo < req.data.validFrom) {
        req.error(400, 'Valid To must be on/after Valid From.');
      }
    }
    req.data.updatedAt = new Date().toISOString();
  });

  this.before('DELETE', Delegations, async (req) => {
    await assertOwner(req, req.data.ID ?? req.params?.[0]?.ID ?? req.params?.[0]);
  });

  this.after(['READ'], Delegations, (data) => {
    const rows = Array.isArray(data) ? data : [data];
    const today = new Date().toISOString().slice(0, 10);
    rows.forEach((row) => {
      if (!row) return;
      if (row.isActive === false) row.status = 'Inactive';
      else if (row.validFrom > today) row.status = 'Future';
      else if (row.validTo < today) row.status = 'Expired';
      else row.status = 'Active';
    });
  });

  this.on('activate', Delegations, async (req) => {
    const id = req.params[0].ID;
    await assertOwner(req, id);
    await UPDATE(Delegations)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where({ ID: id });
    return await SELECT.one.from(Delegations).where({ ID: id });
  });

  this.on('deactivate', Delegations, async (req) => {
    const id = req.params[0].ID;
    await assertOwner(req, id);
    await UPDATE(Delegations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where({ ID: id });
    return await SELECT.one.from(Delegations).where({ ID: id });
  });

  // Role now comes from the server, not the URL
  this.on('getCurrentUser', async (req) => {
    const resolved = resolveUser(req);
    if (!resolved) return;
    return { ...resolved, role: isAdmin(req) ? 'Admin' : 'User' };
  });
});