sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, DateFormat) {
    "use strict";

    return Controller.extend("delegation.controller.MyDelegation", {

        onInit: function () {
            this._sUserEmail = "";
            var that = this;
            var oModel = this.getView().getModel("delegation");

            var sUrlEmail = this._getEmailFromUrl();
            if (sUrlEmail) {
                // Email supplied via URL - use it directly, skip getCurrentUser()
                this._sUserEmail = sUrlEmail;
                this._applyFilters("ALL");
                return;
            }

            var oFunctionBinding = oModel.bindContext("/getCurrentUser(...)");

            oFunctionBinding.execute().then(function () {
                return oFunctionBinding.getBoundContext().requestObject();
            }).then(function (oResult) {
                that._sUserEmail = ((oResult && oResult.email) || "").trim().toLowerCase();
                that._applyFilters("ALL");
            }).catch(function (oError) {
                console.error("getCurrentUser() failed on init:", oError);
                MessageBox.warning("Could not fetch your logged-in user (" + oError.message + "). Showing no delegations until this is resolved.");
                that._applyFilters("ALL");
            });
        },

        // Reads the "email" query parameter from the current browser URL
        // e.g. https://.../MyDelegation?email=abc@gmail.com
        _getEmailFromUrl: function () {
            var oUrlParams = new URLSearchParams(window.location.search);
            var sEmail = oUrlParams.get("email");
            return sEmail ? sEmail.trim().toLowerCase() : "";
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._applyFilters(sKey);
        },

        _applyFilters: function (sKey) {
            var oTable = this.byId("tblMyDlgDelegation");
            var oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }

            var sToday = this._formatDateForFilter(new Date());
            var aFilters = [];

            aFilters.push(new Filter("createdVia", FilterOperator.EQ, "SELF"));
            aFilters.push(new Filter("delegator", FilterOperator.EQ, this._sUserEmail || "__no_user_resolved__"));

            if (sKey === "ACTIVE") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("validFrom", FilterOperator.LE, sToday),
                        new Filter("validTo", FilterOperator.GE, sToday)
                    ],
                    and: true
                }));
            } else if (sKey === "FUTURE") {
                aFilters.push(new Filter("validFrom", FilterOperator.GT, sToday));
            } else if (sKey === "EXPIRED") {
                aFilters.push(new Filter("validTo", FilterOperator.LT, sToday));
            }

            oBinding.filter(aFilters);
        },

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

        onCreateDelegation: function () {
            this._sMode = "CREATE";
            this._oEditContext = null;

            var that = this;
            var sUrlEmail = this._getEmailFromUrl();

            if (sUrlEmail) {
                // Prefill Delegator from URL param and lock the field
                that._openDialogJS({
                    delegator: sUrlEmail,
                    delegateUser: "",
                    application: [],
                    validFrom: null,
                    validTo: null,
                    delegationReason: "",
                    delegatorEditable: false
                });
                return;
            }

            var oModel = this.getView().getModel("delegation");
            var oFunctionBinding = oModel.bindContext("/getCurrentUser(...)");

            oFunctionBinding.execute().then(function () {
                return oFunctionBinding.getBoundContext().requestObject();
            }).then(function (oResult) {
                var sEmail = (oResult && oResult.email) || "";

                if (!sEmail) {
                    MessageBox.warning("Could not determine your logged-in user email. Please enter it manually.");
                }

                that._openDialogJS({
                    delegator: sEmail,
                    delegateUser: "",
                    application: [],
                    validFrom: null,
                    validTo: null,
                    delegationReason: "",
                    delegatorEditable: !sEmail
                });
            }).catch(function (oError) {
                console.error("getCurrentUser() failed:", oError);
                MessageBox.warning("Could not fetch your logged-in user (" + oError.message + "). Please enter the Delegator manually.");
                that._openDialogJS({
                    delegator: "",
                    delegateUser: "",
                    application: [],
                    validFrom: null,
                    validTo: null,
                    delegationReason: "",
                    delegatorEditable: true
                });
            });
        },

        onEditDelegation: function (oEvent) {
            this._sMode = "EDIT";
            var oCtx = oEvent.getSource().getParent().getParent().getBindingContext("delegation");
            this._oEditContext = oCtx;

            var oData = Object.assign({}, oCtx.getObject());

            oData.application = oData.application
                ? oData.application.split(",").map(function (s) { return s.trim(); })
                : [];

            oData.delegatorEditable = false;

            this._openDialogJS(oData);
        },

        _openDialogJS: function (oData) {
            var that = this;
            var oEditModel = new JSONModel(oData);
            this.getView().setModel(oEditModel, "delegationEdit");

            if (!this._oDialog) {
                var oSimpleForm = new sap.ui.layout.form.SimpleForm(this.getView().getId() + "--formDelegation", {
                    editable: true,
                    layout: "ResponsiveGridLayout",
                    content: [
                        new sap.m.Label({ text: "Delegator", required: true }),
                        new sap.m.Input({
                            value: "{delegationEdit>/delegator}",
                            editable: {
                                path: "delegationEdit>/delegatorEditable",
                                type: "sap.ui.model.type.Boolean"
                            }
                        }),

                        new sap.m.Label({ text: "Delegate User", required: true }),
                        new sap.m.Input({ value: "{delegationEdit>/delegateUser}" }),

                        new sap.m.Label({ text: "Application", required: true }),
                        new sap.m.MultiComboBox(this.getView().getId() + "--mcbApplication", {
                            width: "100%",
                            selectedKeys: "{delegationEdit>/application}",
                            items: [
                                new sap.ui.core.Item({ key: "CAF", text: "CAF" }),
                                new sap.ui.core.Item({ key: "eVendor", text: "eVendor" }),
                                new sap.ui.core.Item({ key: "eBG", text: "eBG" }),
                                new sap.ui.core.Item({ key: "ePR", text: "ePR" })
                            ]
                        }),

                        new sap.m.Label({ text: "Valid From", required: true }),
                        new sap.m.DatePicker(this.getView().getId() + "--dpValidFrom", {
                            value: {
                                path: "delegationEdit>/validFrom",
                                type: "sap.ui.model.type.Date",
                                formatOptions: { source: { pattern: "yyyy-MM-dd" } }
                            },
                            change: function (oEvent) { that.onValidFromChange(oEvent); }
                        }),

                        new sap.m.Label({ text: "Valid To", required: true }),
                        new sap.m.DatePicker(this.getView().getId() + "--dpValidTo", {
                            value: {
                                path: "delegationEdit>/validTo",
                                type: "sap.ui.model.type.Date",
                                formatOptions: { source: { pattern: "yyyy-MM-dd" } }
                            }
                        }),

                        new sap.m.Label({ text: "Delegation Reason", required: true }),
                        new sap.m.TextArea({ rows: 3, value: "{delegationEdit>/delegationReason}" })
                    ]
                });
                oSimpleForm.addStyleClass("stlDelegationForm");

                this._oDialog = new sap.m.Dialog({
                    title: "Create Delegation",
                    contentWidth: "30rem",
                    content: [oSimpleForm],
                    beginButton: new sap.m.Button({
                        text: "Submit",
                        type: "Emphasized",
                        press: function () { that.onSubmitDelegation(); }
                    }),
                    endButton: new sap.m.Button({
                        text: "Cancel",
                        press: function () { that.onCancelDelegation(); }
                    })
                });

                this.getView().addDependent(this._oDialog);
            } else {
                this._oDialog.setModel(oEditModel, "delegationEdit");
            }

            this._oDialog.setTitle(this._sMode === "CREATE" ? "Create Delegation" : "Edit Delegation");
            this._oDialog.open();
        },

        onValidFromChange: function (oEvent) {
            var sFrom = oEvent.getParameter("value");
            var oDpFrom = sap.ui.getCore().byId(this.getView().getId() + "--dpValidFrom");
            var oDpTo = sap.ui.getCore().byId(this.getView().getId() + "--dpValidTo");
            if (sFrom && oDpFrom && oDpTo) {
                oDpTo.setMinDate(oDpFrom.getDateValue());
            }
        },

        // ------------------------------------------------------------------
        // NEW: check whether the delegator already has a record for any of
        // the selected applications. Queries the OData model directly
        // (rather than the table's current binding) so the check is correct
        // even if the table is currently filtered to a specific tab.
        // sExcludeId lets EDIT mode ignore the record being edited itself.
        // ------------------------------------------------------------------
        _checkDuplicateApplication: function (sDelegator, aApplications, sExcludeId) {
            var oModel = this.getView().getModel("delegation");
            var oListBinding = oModel.bindList("/Delegations", null, null, [
                new Filter("delegator", FilterOperator.EQ, sDelegator)
            ], { $$groupId: "$direct" });

            return oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var aConflicts = [];
                aContexts.forEach(function (oCtx) {
                    var oRec = oCtx.getObject();
                    if (sExcludeId && oRec.ID === sExcludeId) { return; }

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
            });
        },

        onSubmitDelegation: function () {
            var oEditModel = this.getView().getModel("delegationEdit");
            var oData = oEditModel.getData();

            var oToday = new Date();
            oToday.setHours(0, 0, 0, 0);
            var dFrom = oData.validFrom ? new Date(oData.validFrom) : null;
            var dTo = oData.validTo ? new Date(oData.validTo) : null;
            var aApplications = oData.application || [];

            if (!oData.delegator || !oData.delegateUser || aApplications.length === 0 || !dFrom || !dTo || !oData.delegationReason) {
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
            if (oData.delegator && oData.delegateUser && oData.delegator === oData.delegateUser) {
                MessageToast.show("Delegator and Delegate User cannot be the same.");
                return;
            }

            var that = this;
            var sExcludeId = (this._sMode === "EDIT" && this._oEditContext) ? this._oEditContext.getObject().ID : null;

            this._checkDuplicateApplication(oData.delegator, aApplications, sExcludeId).then(function (aConflicts) {
                if (aConflicts.length > 0) {
                    var aDupApps = [];
                    aConflicts.forEach(function (oConflict) {
                        oConflict.duplicateApps.forEach(function (sApp) {
                            if (aDupApps.indexOf(sApp) === -1) { aDupApps.push(sApp); }
                        });
                    });
                    MessageToast.show("A delegation already exists for " + oData.delegator + " and application(s): " + aDupApps.join(", ") + ". Only one record per delegator/application is allowed.");
                    return;
                }
                that._saveDelegation(oData, aApplications);
            }).catch(function (oError) {
                MessageToast.show("Could not validate existing delegations: " + oError.message);
                console.error("Duplicate check failed:", oError);
            });
        },

        _saveDelegation: function (oData, aApplications) {
            var that = this;
            var oNow = new Date().toISOString();

            var oPayload = {
                delegator: oData.delegator,
                delegateUser: oData.delegateUser,
                application: aApplications.join(","),
                validFrom: oData.validFrom,
                validTo: oData.validTo,
                delegationReason: oData.delegationReason
            };

            if (this._sMode === "CREATE") {
                oPayload.createdAt = oNow;
                oPayload.createdBy = oData.delegator;
                oPayload.createdVia = "SELF";

                var oListBinding = this.byId("tblMyDlgDelegation").getBinding("items");

                if (!oListBinding) {
                    MessageToast.show("Table binding not found.");
                    return;
                }

                var oContext;
                try {
                    oContext = oListBinding.create(oPayload);
                } catch (oSyncError) {
                    MessageToast.show("Save failed: " + oSyncError.message);
                    console.error("oListBinding.create() threw synchronously:", oSyncError);
                    return;
                }

                oContext.created().then(function () {
                    that._oDialog.close();
                    MessageToast.show("Delegation saved.");
                }).catch(function (oError) {
                    MessageToast.show("Save failed: " + oError.message);
                    console.error("oContext.created() rejected:", oError);
                });

            } else {
                if (!this._oEditContext) {
                    MessageToast.show("No record selected for edit.");
                    return;
                }

                oPayload.updatedAt = oNow;

                Object.keys(oPayload).forEach(function (sKey) {
                    that._oEditContext.setProperty(sKey, oPayload[sKey]);
                });

                var oModel = this.getView().getModel("delegation");
                oModel.submitBatch("$auto").then(function () {
                    that._oDialog.close();
                    MessageToast.show("Delegation updated.");
                }).catch(function (oError) {
                    MessageToast.show("Update failed: " + oError.message);
                    console.error("submitBatch failed on edit:", oError);
                });
            }
        },
        onCancelDelegation: function () {
            this._oDialog.close();
        },
        onDeleteDelegation: function (oEvent) {
            var oCtx = oEvent.getSource().getParent().getParent().getBindingContext("delegation");
            if (!oCtx) { return; }

            MessageBox.confirm("Delete this delegation?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        oCtx.delete().then(function () {
                            MessageToast.show("Deleted.");
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
            var oTable = this.byId("tblMyDlgDelegation");
            var oItem = oTable && oTable.getSelectedItem();
            var oCtx = oItem && oItem.getBindingContext("delegation");
            if (!oCtx) {
                MessageToast.show("Select a row first.");
                return;
            }
            oCtx.setProperty("isActive", bActivate);
        },
        clearFilters: function () {
            this._applyFilters("ALL");
            var oTabBar = this.byId("idMyDlgIconTabBar");
            if (oTabBar) { oTabBar.setSelectedKey("ALL"); }
        },
        onRefresh: function () {
            var oTable = this.byId("tblMyDlgDelegation");
            if (oTable) {
                oTable.getBinding("items").refresh();
            }
            MessageToast.show("Refreshed.");
        }
    });
});