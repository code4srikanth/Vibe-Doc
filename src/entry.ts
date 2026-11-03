// The page's entry: /disclaimer shows the disclaimer alone; every other path runs the app (main.ts) with the disclaimer link on top.
import { isDisclaimerPage, mountFooter, showDisclaimerPage } from "./ui/disclaimer.ts";

if (isDisclaimerPage()) {
  showDisclaimerPage();
} else {
  mountFooter();
  void import("./main.ts");
}
