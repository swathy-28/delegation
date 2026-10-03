namespace delegation;
using { cuid } from '@sap/cds/common';

entity Delegations : cuid {
  delegator        : String(120);   // self-service: auto-filled from logged-in user; admin: chosen explicitly
  delegateUser     : String(120)  @mandatory;
  application      : String(200)  @mandatory;   // comma-separated multi-select, e.g. "CAF,eVendor,eBG"
  validFrom        : Date         @mandatory;
  validTo          : Date         @mandatory;
  delegationReason : String(255);
  isActive         : Boolean default true;
  virtual status   : String(20);   // filled by service handler on READ
  createdBy        : String(120);                                          // = delegator, set client-side
  createdAt        : Timestamp    @cds.on.insert: $now;                    // server-stamped, immutable
  updatedAt        : Timestamp    @cds.on.insert: $now @cds.on.update: $now; // server-stamped
  createdVia       : String(10)   @mandatory enum {
    SELF  = 'SELF';    // created via "My Delegation"
    ADMIN = 'ADMIN';   // created via "Delegation Admin"
  };
}