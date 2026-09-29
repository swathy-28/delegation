sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], function (Controller, Fragment, JSONModel, MessageToast, MessageBox, DateFormat) {
    "use strict";
    // ---------------------------------------------------------------------
    // WARNING: client credentials are embedded here for local/dev testing
    // ONLY. Anyone who opens browser dev tools can read CLIENT_SECRET out
    // of this bundle. Before this goes anywhere beyond your own testing,
    // move this to a BTP destination (OAuth2ClientCredentials) + approuter
    // so the secret never ships to the browser. Also: rotate this secret
    // if it has ever been pasted/shared outside a secure channel.
    // ---------------------------------------------------------------------
    var TOKEN_URL   = "https://stl-dev-build-auto-au-sjrlfl26.authentication.ap10.hana.ondemand.com/oauth/token";
    var API_BASE    = "https://st-logistics-pte-ltd-stl-dev-build-auto-au-sjrlfl26-dev4270780a.cfapps.ap10.hana.ondemand.com/delegation/Delegations";
    var CLIENT_ID     = "sb-delegation-cap-dev!t42644";
    var CLIENT_SECRET = "382607d4-3408-43a7-b48e-a03296791bbd$zzQdvfllCDGkYYCVaxafR7Y4QSe_m1bCWi7oYIfmp1I=";
    return Controller.extend("delegation.controller.DelegationPage", {
        onInit: function () {
            // Plain JSONModel named "delegation" -- keeps all {delegation>...}
            // bindings in the view working exactly as before, just backed by
            // fetch() calls instead of an OData V4 model.
            this._oDelegationModel = new JSONModel({ Delegations: [] });
            this.getView().setModel(this._oDelegationModel, "delegation");

            this._aAllDelegations = [];   // unfiltered cache
            this._sCurrentTab = "ALL";
            this._oToken = null;          // { access_token, expiresAt }

            this._loadDelegations();
        },

        _isAdmin: function () {
            return !!this.getOwnerComponent().getModel("app").getProperty("/isAdmin");
        },

        _getCurrentEmail: function () {
            return this.getOwnerComponent().getModel("app").getProperty("/email");
        },

        // ------------------------------------------------------------------
        // Auth
        // ------------------------------------------------------------------
        _getAccessToken: function () {
            var that = this;
            var now = Date.now();

            if (this._oToken && this._oToken.expiresAt > now + 5000) {
                return Promise.resolve(this._oToken.access_token);
            }

            var oParams = new URLSearchParams();
            oParams.set("grant_type", "client_credentials");

            var sBasic = btoa(CLIENT_ID + ":" + CLIENT_SECRET);

            return fetch(TOKEN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Basic " + sBasic
                },
                body: oParams.toString()
            }).then(function (oRes) {
                if (!oRes.ok) {
                    return oRes.text().then(function (sText) {
                        throw new Error("Token request failed (" + oRes.status + "): " + sText);
                    });
                }
                return oRes.json();
            }).then(function (oData) {
                that._oToken = {
                    access_token: oData.access_token,
                    expiresAt: Date.now() + (oData.expires_in ? oData.expires_in * 1000 : 10 * 60 * 1000)
                };
                return that._oToken.access_token;
            });
        },

        // ------------------------------------------------------------------
        // Generic authenticated request helper
        // ------------------------------------------------------------------
        _apiRequest: function (sMethod, sUrl, oBody) {
            return this._getAccessToken().then(function (sToken) {
                var oOptions = {
                    method: sMethod,
                    headers: {
                        "Authorization": "Bearer " + sToken,
                        "Accept": "application/json"
                    }
                };
                if (oBody !== undefined) {
                    oOptions.headers["Content-Type"] = "application/json";
                    oOptions.body = JSON.stringify(oBody);
                }
                return fetch(sUrl, oOptions);
            }).then(function (oRes) {
                if (!oRes.ok) {
                    return oRes.text().then(function (sText) {
                        throw new Error(sMethod + " " + sUrl + " failed (" + oRes.status + "): " + sText);
                    });
                }
                // DELETE / some PATCH responses may have no body
                return oRes.status === 204 ? null : oRes.json().catch(function () { return null; });
            });
        },

        // ------------------------------------------------------------------
        // Load + status computation + role/tab filtering
        // ------------------------------------------------------------------
        _computeStatus: function (oRecord) {
            var sToday = this._formatDateForFilter(new Date());
            if (oRecord.validFrom > sToday) { return "Future"; }
            if (oRecord.validTo < sToday) { return "Expired"; }
            return "Active";
        },

        _loadDelegations: function () {
            var that = this;
            return this._apiRequest("GET", API_BASE).then(function (oData) {
                var aRecords = (oData && (oData.value || oData.d && oData.d.results || oData)) || [];
                if (!Array.isArray(aRecords)) { aRecords = []; }

                aRecords.forEach(function (oRec) {
                    oRec.status = that._computeStatus(oRec);
                });

                that._aAllDelegations = aRecords;
                that._applyFilters();
            }).catch(function (oError) {
                MessageToast.show("Failed to load delegations: " + oError.message);
            });
        },

        _applyFilters: function () {
            var that = this;
            var aFiltered = this._aAllDelegations.slice();

            // Role scope: admin sees all, everyone else sees only their own
            if (!this._isAdmin()) {
                var sEmail = this._getCurrentEmail();
                aFiltered = aFiltered.filter(function (oRec) {
                    return oRec.delegator === sEmail;
                });
            }

            // Tab scope
            if (this._sCurrentTab !== "ALL") {
                aFiltered = aFiltered.filter(function (oRec) {
                    return oRec.status === (that._sCurrentTab === "ACTIVE" ? "Active"
                        : that._sCurrentTab === "FUTURE" ? "Future"
                        : "Expired");
                });
            }

            this._oDelegationModel.setProperty("/Delegations", aFiltered);
        },

        onTabSelect: function (oEvent) {
            this._sCurrentTab = oEvent.getParameter("key");
            this._applyFilters();
        },

        clearFilters: function () {
            this._sCurrentTab = "ALL";
            var oTabBar = this.byId("idAdmIconTabBar");
            if (oTabBar) { oTabBar.setSelectedKey("ALL"); }
            this._applyFilters();
        },

        onRefresh: function () {
            this._loadDelegations().then(function () {
                MessageToast.show("Refreshed.");
            });
        },

        // ------------------------------------------------------------------
        // Formatting
        // ------------------------------------------------------------------
        formatTimestamp: function (vValue) {
            if (!vValue) { return ""; }
            var oDate = (vValue instanceof Date) ? vValue : new Date(vValue);
            if (isNaN(oDate.getTime())) { return ""; }
            var oDateFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            return oDateFormat.format(oDate);
        },

        _formatDateForFilter: function (oDate) {
            var yyyy = oDate.getFullYear();
            var mm = String(oDate.getMonth() + 1).padStart(2, "0");
            var dd = String(oDate.getDate()).padStart(2, "0");
            return yyyy + "-" + mm + "-" + dd;
        },

        // ------------------------------------------------------------------
        // Create / Edit dialog
        // ------------------------------------------------------------------
        onCreateDelegation: function () {
            this._sMode = "CREATE";
            this._oEditRecord = null;

            var sDelegator = this._isAdmin() ? "" : this._getCurrentEmail();

            this._openDialogJS({
                delegator: sDelegator,
                delegateUser: "",
                application: [],
                validFrom: null,
                validTo: null,
                delegationReason: ""
            });
        },

        onEditDelegation: function (oEvent) {
            this._sMode = "EDIT";
            var oCtx = oEvent.getSource().getParent().getParent().getBindingContext("delegation");
            var oOriginal = oCtx.getObject();
            this._oEditRecord = oOriginal;

            var oData = Object.assign({}, oOriginal);
            oData.application = oData.application
                ? oData.application.split(",").map(function (s) { return s.trim(); })
                : [];

            this._openDialogJS(oData);
        },

        _openDialogJS: function (oData) {
            var that = this;
            var oEditModel = new JSONModel(oData);
            this.getView().setModel(oEditModel, "delegationEdit");

            var finishOpen = function () {
                that._oDialog.setModel(oEditModel, "delegationEdit");
                that._oDialog.setTitle(that._sMode === "CREATE" ? "Create Delegation" : "Edit Delegation");
                that._oDialog.open();
            };

            if (!this._oDialog) {
                Fragment.load({
                    id: this.getView().getId(),
                    name: "delegation.view.fragment.DelegationForm",
                    controller: this
                }).then(function (oDialog) {
                    that._oDialog = oDialog;
                    that.getView().addDependent(oDialog);
                    finishOpen();
                });
            } else {
                finishOpen();
            }
        },

        onValidFromChange: function (oEvent) {
            var sFrom = oEvent.getParameter("value");
            var oDpFrom = this.byId("dpValidFrom");
            var oDpTo = this.byId("dpValidTo");
            if (sFrom && oDpFrom && oDpTo) {
                oDpTo.setMinDate(oDpFrom.getDateValue());
            }
        },

        // ------------------------------------------------------------------
        // NEW: check whether the delegator already has a record for any of
        // the selected applications, using the already-loaded cache.
        // sExcludeId lets EDIT mode ignore the record being edited itself.
        // ------------------------------------------------------------------
        _checkDuplicateApplication: function (sDelegator, aApplications, sExcludeId) {
            var aConflicts = [];

            this._aAllDelegations.forEach(function (oRec) {
                if (sExcludeId && oRec.ID === sExcludeId) { return; }
                if (oRec.delegator !== sDelegator) { return; }

                var aExistingApps = oRec.application
                    ? oRec.application.split(",").map(function (s) { return s.trim(); })
                    : [];
                var aDup = aExistingApps.filter(function (sApp) {
                    return aApplications.indexOf(sApp) !== -1;
                });
                if (aDup.length) {
                    aConflicts.push({ record: oRec, duplicateApps: aDup });
                }
            });

            return aConflicts;
        },

        onSubmitDelegation: function () {
            var that = this;
            var oEditModel = this._oDialog.getModel("delegationEdit");
            var oData = oEditModel.getData();

            var oToday = new Date();
            oToday.setHours(0, 0, 0, 0);
            var dFrom = oData.validFrom ? new Date(oData.validFrom) : null;
            var dTo = oData.validTo ? new Date(oData.validTo) : null;
            var aApplications = oData.application || [];

            var sDelegator = this._isAdmin() ? oData.delegator : this._getCurrentEmail();

            if (!sDelegator || !oData.delegateUser || aApplications.length === 0 || !dFrom || !dTo || !oData.delegationReason) {
                MessageToast.show("Please fill all required fields.");
                return;
            }
            if (dFrom < oToday) {
                MessageToast.show("Valid From cannot be in the past.");
                return;
            }
            if (dTo < dFrom) {
                MessageToast.show("Valid To must be on/after Valid From.");
                return;
            }
            if (sDelegator && oData.delegateUser && sDelegator === oData.delegateUser) {
                MessageToast.show("Delegator and Delegate User cannot be the same.");
             return;
            }

            var sExcludeId = (this._sMode === "EDIT" && this._oEditRecord) ? this._oEditRecord.ID : null;
            var aConflicts = this._checkDuplicateApplication(sDelegator, aApplications, sExcludeId);

            if (aConflicts.length > 0) {
                var aDupApps = [];
                aConflicts.forEach(function (oConflict) {
                    oConflict.duplicateApps.forEach(function (sApp) {
                        if (aDupApps.indexOf(sApp) === -1) { aDupApps.push(sApp); }
                    });
                });
                MessageToast.show("A delegation already exists for " + sDelegator + " and application(s): " + aDupApps.join(", ") + ". Only one record per delegator/application is allowed.");
                return;
            }

            var oPayload = {
                delegator: sDelegator,
                delegateUser: oData.delegateUser,
                application: aApplications.join(","),
                validFrom: oData.validFrom,
                validTo: oData.validTo,
                delegationReason: oData.delegationReason
            };

            if (this._sMode === "CREATE") {
                oPayload.isActive = true;
                oPayload.createdVia = this._isAdmin() ? "ADMIN" : "SELF";

                this._apiRequest("POST", API_BASE, oPayload).then(function () {
                    that._oDialog.close();
                    MessageToast.show("Delegation saved.");
                    return that._loadDelegations();
                }).catch(function (oError) {
                    MessageToast.show("Save failed: " + oError.message);
                });

            } else {
                if (!this._oEditRecord || !this._oEditRecord.ID) {
                    MessageToast.show("No record selected for edit.");
                    return;
                }
                oPayload.createdBy = sDelegator;

                var sUrl = API_BASE + "(" + this._oEditRecord.ID + ")";
                this._apiRequest("PATCH", sUrl, oPayload).then(function () {
                    that._oDialog.close();
                    MessageToast.show("Delegation updated.");
                    return that._loadDelegations();
                }).catch(function (oError) {
                    MessageToast.show("Update failed: " + oError.message);
                });
            }
        },

        onCancelDelegation: function () {
            this._oDialog.close();
        },

        onDeleteDelegation: function (oEvent) {
            var that = this;
            var oCtx = oEvent.getSource().getParent().getParent().getBindingContext("delegation");
            var oRecord = oCtx && oCtx.getObject();
            if (!oRecord || !oRecord.ID) { return; }

            MessageBox.confirm("Delete this delegation?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var sUrl = API_BASE + "(" + oRecord.ID + ")";
                        that._apiRequest("DELETE", sUrl).then(function () {
                            MessageToast.show("Deleted.");
                            return that._loadDelegations();
                        }).catch(function (oError) {
                            MessageToast.show("Delete failed: " + oError.message);
                        });
                    }
                }
            });
        },

        onActivate: function () { this._toggleStatus(true); },
        onDeactivate: function () { this._toggleStatus(false); },

        _toggleStatus: function (bActivate) {
            var that = this;
            var oTable = this.byId("tblAdmDelegation");
            var oItem = oTable && oTable.getSelectedItem();
            var oCtx = oItem && oItem.getBindingContext("delegation");
            var oRecord = oCtx && oCtx.getObject();

            if (!oRecord || !oRecord.ID) {
                MessageToast.show("Select a row first.");
                return;
            }

            var sUrl = API_BASE + "(" + oRecord.ID + ")";
            this._apiRequest("PATCH", sUrl, { isActive: bActivate }).then(function () {
                MessageToast.show(bActivate ? "Activated." : "Deactivated.");
                return that._loadDelegations();
            }).catch(function (oError) {
                MessageToast.show("Update failed: " + oError.message);
            });
        }
    });
});