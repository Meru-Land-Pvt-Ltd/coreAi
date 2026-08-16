/**
 * The published product site — public surface.
 *
 * What the /a/<slug> routes render, and the one place a caller should import
 * the site chrome from:
 *
 *   import { ProductSite, productPagePath } from "@/components/agent-page/spec/site";
 */

export { ProductSite, type ProductSiteProps } from "./product-site";
export { ProductPageMissing, type ProductPageMissingProps } from "./product-page-missing";
export {
  productHomePage,
  productHomePath,
  productPagePath,
  productPathForPageId
} from "./product-links";
