const HTMLElementBase = globalThis.HTMLElement ??
    class {
    };
function describe(host) {
    return `<${host.localName || "manner-form"}>`;
}
function error(host, message) {
    console.error(`${describe(host)}: ${message}`, host);
}
function ownedBy(host, element) {
    let current = element;
    while (current) {
        if (current === host)
            return true;
        const registered = globalThis.customElements?.get(current.localName);
        if (current instanceof MannerForm ||
            registered === MannerForm ||
            (registered && registered.prototype instanceof MannerForm))
            return false;
        current = current.parentElement;
    }
    return false;
}
function isFormControl(element) {
    return ((element.localName === "input" ||
        element.localName === "select" ||
        element.localName === "textarea" ||
        element.localName === "button") &&
        "willValidate" in element &&
        "validity" in element);
}
export class MannerForm extends HTMLElementBase {
    #initialized = false;
    #bootObserver = null;
    #bootTimer = null;
    #bootController = null;
    #abortController = null;
    #form;
    #controls = [];
    #fieldsets = [];
    #summaries = [];
    #errors = [];
    #summaryItems = [];
    #activeInvalid = new Set();
    #originalNoValidate = false;
    #originalDescribedBy = new WeakMap();
    #originalAriaInvalid = new WeakMap();
    connectedCallback() {
        if (this.#initialized) {
            this.#form.noValidate = true;
            this.#bindRuntime();
            return;
        }
        const result = this.#tryUpgrade();
        if (result.state !== "pending")
            return;
        this.#bootObserver?.disconnect();
        this.#bootController?.abort();
        const controller = new AbortController();
        this.#bootController = controller;
        this.#bootObserver = new MutationObserver(() => this.#tryUpgrade());
        this.#bootObserver.observe(this, { childList: true, subtree: true });
        this.#bootTimer = setTimeout(() => {
            this.#bootTimer = null;
            this.#tryUpgrade(this.ownerDocument?.readyState !== "loading");
        }, 0);
        this.ownerDocument?.addEventListener("DOMContentLoaded", this.#onDOMContentLoaded, {
            once: true,
            signal: controller.signal,
        });
    }
    disconnectedCallback() {
        this.#stopBootstrap();
        this.#abortController?.abort();
        this.#abortController = null;
        if (this.#form)
            this.#form.noValidate = this.#originalNoValidate;
    }
    refresh() {
        const result = this.#buildModel(true);
        if (result.state === "valid")
            this.#commit(result.model);
    }
    validate() {
        if (!this.#form)
            throw new Error(`${describe(this)} is not upgraded`);
        const valid = this.#form.checkValidity();
        this.#syncAll();
        return valid;
    }
    #onDOMContentLoaded = () => {
        this.#tryUpgrade(true);
    };
    #tryUpgrade(finalize = false) {
        const result = this.#buildModel(finalize);
        if (result.state === "valid")
            this.#commit(result.model);
        else if (result.state === "invalid")
            this.#stopBootstrap();
        return result;
    }
    #stopBootstrap() {
        this.#bootObserver?.disconnect();
        this.#bootObserver = null;
        if (this.#bootTimer !== null)
            clearTimeout(this.#bootTimer);
        this.#bootTimer = null;
        this.#bootController?.abort();
        this.#bootController = null;
    }
    #discover(selector) {
        return [...this.querySelectorAll(selector)].filter((element) => ownedBy(this, element));
    }
    #buildModel(finalize) {
        const forms = this.#discover("form");
        const summaries = this.#discover("[data-error-summary]");
        const errors = this.#discover("[data-error-for]");
        const summaryItems = this.#discover("[data-summary-for]");
        const invalid = (message) => {
            error(this, message);
            return { state: "invalid" };
        };
        if (!finalize && (this.ownerDocument?.readyState === "loading" || forms.length === 0)) {
            return { state: "pending" };
        }
        if (forms.length !== 1)
            return invalid(`Expected exactly one owned <form>; found ${forms.length}.`);
        const form = forms[0];
        const controls = [...form.elements]
            .filter((element) => isFormControl(element))
            .filter((element) => element.form === form && ownedBy(this, element));
        const fieldsets = this.#discover("fieldset").filter((fieldset) => fieldset.form === form);
        const focusMode = this.getAttribute("data-error-focus") || "first";
        if (focusMode !== "first")
            return invalid(`Unsupported data-error-focus value "${focusMode}".`);
        for (const control of controls) {
            const authored = control.getAttribute("aria-invalid");
            if (authored && authored !== "true" && authored !== "false") {
                return invalid("A form control has an invalid authored aria-invalid value.");
            }
        }
        const controlById = new Map();
        const fieldsetById = new Map();
        for (const control of controls) {
            if (control.id && controlById.has(control.id))
                return invalid(`Duplicate owned control id "${control.id}".`);
            if (control.id)
                controlById.set(control.id, control);
        }
        for (const fieldset of fieldsets) {
            if (fieldset.id && fieldsetById.has(fieldset.id))
                return invalid(`Duplicate owned fieldset id "${fieldset.id}".`);
            if (fieldset.id)
                fieldsetById.set(fieldset.id, fieldset);
        }
        for (const node of errors) {
            const targetId = node.getAttribute("data-error-for") || "";
            if (!/^\S+$/.test(targetId) || (!controlById.has(targetId) && !fieldsetById.has(targetId))) {
                return invalid(`An error node references missing control or fieldset "${targetId}".`);
            }
            if (!node.id)
                return invalid("Every [data-error-for] node requires an authored id.");
        }
        for (const node of summaryItems) {
            const targetId = node.getAttribute("data-summary-for") || "";
            if (!/^\S+$/.test(targetId) || (!controlById.has(targetId) && !fieldsetById.has(targetId))) {
                return invalid(`A summary node references missing control or fieldset "${targetId}".`);
            }
        }
        const relevantIds = new Set();
        for (const control of controls) {
            if (control.id)
                relevantIds.add(control.id);
            for (const id of (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)) {
                relevantIds.add(id);
            }
        }
        for (const fieldset of fieldsets)
            if (fieldset.id)
                relevantIds.add(fieldset.id);
        for (const node of errors)
            relevantIds.add(node.id);
        const documentIds = [...(this.ownerDocument?.querySelectorAll("[id]") || [])];
        for (const id of relevantIds) {
            if (documentIds.filter((element) => element.id === id).length > 1) {
                return invalid(`Duplicate authored id "${id}" would make an error relationship ambiguous.`);
            }
        }
        return { state: "valid", model: { form, controls, fieldsets, summaries, errors, summaryItems } };
    }
    #commit(model) {
        this.#stopBootstrap();
        const formChanged = this.#form !== model.form;
        if (formChanged && this.#form) {
            this.#abortController?.abort();
            this.#abortController = null;
            this.#form.noValidate = this.#originalNoValidate;
        }
        this.#form = model.form;
        this.#controls = model.controls;
        this.#fieldsets = model.fieldsets;
        this.#summaries = model.summaries;
        this.#errors = model.errors;
        this.#summaryItems = model.summaryItems;
        if (formChanged)
            this.#originalNoValidate = this.#form.noValidate;
        for (const control of this.#controls) {
            if (!this.#originalDescribedBy.has(control)) {
                this.#originalDescribedBy.set(control, {
                    present: control.hasAttribute("aria-describedby"),
                    value: control.getAttribute("aria-describedby") || "",
                });
                this.#originalAriaInvalid.set(control, {
                    present: control.hasAttribute("aria-invalid"),
                    value: control.getAttribute("aria-invalid") || "",
                });
            }
        }
        this.#activeInvalid = new Set(this.#controls.filter((control) => this.#activeInvalid.has(control)));
        this.#form.noValidate = true;
        this.#initialized = true;
        this.#hideInactivePresentation();
        for (const control of this.#activeInvalid)
            this.#syncControl(control);
        this.#updateSummary();
        this.#bindRuntime();
    }
    #bindRuntime() {
        if (this.#abortController)
            return;
        const controller = new AbortController();
        this.#abortController = controller;
        this.#form.addEventListener("submit", this.#onSubmit, { signal: controller.signal });
        this.#form.addEventListener("invalid", this.#onInvalid, { capture: true, signal: controller.signal });
        this.#form.addEventListener("input", this.#onInput, { signal: controller.signal });
        this.#form.addEventListener("change", this.#onInput, { signal: controller.signal });
        this.#form.addEventListener("reset", this.#onReset, { signal: controller.signal });
    }
    #controlFromTarget(target) {
        if (!(target instanceof Element) || !isFormControl(target))
            return null;
        return this.#controls.includes(target) && target.form === this.#form ? target : null;
    }
    #onSubmit = (event) => {
        if (this.#form.checkValidity()) {
            this.#syncAll();
            return;
        }
        event.preventDefault();
        this.#syncAll();
        const invalidControls = this.#controls.filter((control) => control.willValidate && !control.validity.valid);
        const firstInvalid = invalidControls.find((control) => control.getClientRects().length > 0) || invalidControls[0];
        firstInvalid?.focus();
        this.dispatchEvent(new CustomEvent("manner-form-invalid", {
            bubbles: true,
            detail: { controls: invalidControls },
        }));
    };
    #onInvalid = (event) => {
        const control = this.#controlFromTarget(event.target);
        if (control)
            this.#syncControl(control);
    };
    #onInput = (event) => {
        const control = this.#controlFromTarget(event.target);
        if (!control)
            return;
        if (this.#activeInvalid.has(control) || control.validity.valid)
            this.#syncControl(control);
    };
    #onReset = (event) => {
        // The reset event fires before the controls have been restored. Defer the
        // cleanup so a reset returns the presentation to its pristine state too.
        queueMicrotask(() => {
            if (event.defaultPrevented)
                return;
            this.#activeInvalid.clear();
            this.#hideInactivePresentation();
            this.#updateSummary();
        });
    };
    #syncAll() {
        for (const control of this.#controls)
            this.#syncControl(control);
        this.#updateSummary();
    }
    #syncControl(control) {
        if (!control.willValidate || control.validity.valid) {
            this.#activeInvalid.delete(control);
            this.#restoreControl(control);
            this.#setPresentation(control, false);
        }
        else {
            this.#activeInvalid.add(control);
            control.setAttribute("aria-invalid", "true");
            this.#setPresentation(control, true);
        }
        this.#updateSummary();
    }
    #restoreControl(control) {
        const describedBy = this.#originalDescribedBy.get(control);
        if (describedBy?.present)
            control.setAttribute("aria-describedby", describedBy.value);
        else
            control.removeAttribute("aria-describedby");
        const ariaInvalid = this.#originalAriaInvalid.get(control);
        if (ariaInvalid?.present)
            control.setAttribute("aria-invalid", ariaInvalid.value);
        else
            control.removeAttribute("aria-invalid");
    }
    #targetIdsForControl(control) {
        const ids = control.id ? [control.id] : [];
        const fieldset = control.closest("fieldset");
        if (fieldset && this.#fieldsets.includes(fieldset) && fieldset.id)
            ids.push(fieldset.id);
        return ids;
    }
    #setPresentation(control, visible) {
        const targetIds = this.#targetIdsForControl(control);
        if (targetIds.length === 0)
            return;
        const errors = this.#errors.filter((node) => targetIds.includes(node.getAttribute("data-error-for") || ""));
        const summaryItems = this.#summaryItems.filter((node) => targetIds.includes(node.getAttribute("data-summary-for") || ""));
        for (const node of errors)
            node.hidden = !visible;
        for (const node of summaryItems)
            node.hidden = !visible;
        const original = this.#originalDescribedBy.get(control);
        if (!original || !visible)
            return;
        const ids = [original.value, ...errors.map((node) => node.id)].join(" ").split(/\s+/).filter(Boolean);
        control.setAttribute("aria-describedby", [...new Set(ids)].join(" "));
    }
    #hideInactivePresentation() {
        for (const node of this.#errors)
            node.hidden = true;
        for (const node of this.#summaryItems)
            node.hidden = true;
        for (const control of this.#controls) {
            if (!this.#activeInvalid.has(control))
                this.#restoreControl(control);
        }
    }
    #updateSummary() {
        const visibleIds = new Set([...this.#activeInvalid]
            .filter((control) => this.#summaryItems.some((node) => this.#targetIdsForControl(control).includes(node.getAttribute("data-summary-for") || "")))
            .flatMap((control) => this.#targetIdsForControl(control)));
        for (const summary of this.#summaries)
            summary.hidden = visibleIds.size === 0;
    }
}
