import { reportFixtureMisses } from "./fixtures.js";

/** Turns a fixture gap into a failed run — see `reportFixtureMisses`. */
export default function globalTeardown(): void {
  reportFixtureMisses();
}
