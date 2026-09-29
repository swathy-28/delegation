sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel",
    "delegation/model/models"
], (UIComponent, Device, JSONModel, models) => {
    "use strict";

    return UIComponent.extend("delegation.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        /**
         * This is the ONE place that decides "Admin Delegation" vs
         * "My Delegation" - both live behind the same index.html / URL.
         *
         * role/email can arrive from TWO places depending on how the app
         * is opened, and both are read here - nothing is hardcoded:
         *
         *   1. Standalone, direct index.html (local testing without FLP):
         *        ...index.html?email=jane.doe@example.com&role=Admin
         *      -> lands in window.location.search
         *
         *   2. Through the Fiori Launchpad / local FLP sandbox preview,
         *      where parameters travel as part of the intent hash and are
         *      delivered to the component as FLP "startup parameters"
         *      (window.location.search does NOT contain them there):
         *        .../test/flp.html#app-preview?email=jane.doe@example.com&role=Admin
         *      -> lands in this.getComponentData().startupParameters
         *
         * Any role other than "Admin" (Approver, NormalUser, etc.) gets
         * the self-service "My Delegation" experience. Both modes read
         * and write the SAME OData entity / SAME DB table - the only
         * thing that changes is what the UI shows and which rows it asks
         * the server for.
         */
        init() {
            UIComponent.prototype.init.apply(this, arguments);

            this.setModel(this._createAppModel(), "app");
            this.setModel(models.createDeviceModel(), "device");

            this.getRouter().initialize();
        },

        _getStartupParameter(sName) {
            // Standalone URL query string, e.g. index.html?role=Admin
            const oParams = new URLSearchParams(window.location.search);
            const sFromQuery = (oParams.get(sName) || "").trim();
            if (sFromQuery) {
                return sFromQuery;
            }

            // FLP / local sandbox preview: params passed after the intent
            // hash (e.g. #app-preview?role=Admin) arrive here instead.
            const oComponentData = this.getComponentData();
            const oStartupParams = (oComponentData && oComponentData.startupParameters) || {};
            const aFromFlp = oStartupParams[sName];
            if (Array.isArray(aFromFlp) && aFromFlp.length > 0) {
                return (aFromFlp[0] || "").trim();
            }

            return "";
        },

        _createAppModel() {
            const sEmail = this._getStartupParameter("email").toLowerCase();
            const sRoleRaw = this._getStartupParameter("role") || "NormalUser";

            // Only an exact "Admin" role gets the admin experience.
            // Everything else (Approver, NormalUser, ApproverUser, ...)
            // is treated as self-service "My Delegation".
            const bIsAdmin = sRoleRaw.toLowerCase() === "admin";

            return new JSONModel({
                email: sEmail,
                role: sRoleRaw,
                isAdmin: bIsAdmin,
                pageTitle: bIsAdmin ? "Delegation Admin" : "My Delegation",
                // used to stamp new rows so admins can see, in the Admin
                // view, whether a delegation was self-service or admin-made
                createdByRole: bIsAdmin ? "Admin" : "Approver"
            });
        }
    });
});