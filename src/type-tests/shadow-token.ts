import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";

// A shadow token names a whole shadow definition.
Style.slot({ shadow: "md" });
StyleUtils.elevated("lg");
Style.slot({ shadow: { x: 0, y: 1, blur: 2, color: "black" } });

// @ts-expect-error a shadow token's fields are not token paths
Style.slot({ shadow: "md.blur" });
