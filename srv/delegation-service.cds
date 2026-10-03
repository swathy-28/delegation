using delegation as db from '../db/schema';

service DelegationService @(path: '/delegation') {

  entity Delegations as projection on db.Delegations actions {
    action activate();
    action deactivate();
  };

  // Used by the UI on load to resolve who's logged in / what role they
  // have, purely from the URL (?email=...&role=...) - falls back to the
  // authenticated req.user if those aren't present.
  function getCurrentUser(email : String, role : String) returns {
    id    : String;
    email : String;
    role  : String;
  };
}
