import { getAppUrl } from "./config.js";

const frame = document.querySelector("#app");
// EAS static hosting emits extension.html. Unlike the long-standing app routes,
// a newly added clean URL may not receive a rewrite immediately, so point the
// companion at the concrete static document.
frame.src = `${await getAppUrl()}/extension.html`;
