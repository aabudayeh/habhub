import { getAppUrl } from "./config.js";

const frame = document.querySelector("#app");
const appUrl = await getAppUrl();

// The toolbar popup is the real app, including its own navigation, with no
// extension-specific mode controls or floating cards layered over it.
frame.src = new URL("/", appUrl).toString();
