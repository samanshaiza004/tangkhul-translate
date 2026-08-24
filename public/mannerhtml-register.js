import { MannerForm } from "/static/mannerhtml-form-0.2.0.js";

if (!customElements.get("manner-form")) {
  customElements.define("manner-form", MannerForm);
}
