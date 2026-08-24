import { Redirect } from "expo-router";

/**
 * Compatibility route for older extension packages that opened /extension.
 * The current toolbar popup opens / directly; redirecting old packages keeps
 * the exact same full app and navigation without a second companion surface.
 */
export default function ExtensionRedirect() {
  return <Redirect href={"/" as never} />;
}
