declare module "pdf-parse/lib/pdf-parse.js" {
  import type pdfParse from "pdf-parse";

  const parse: typeof pdfParse;
  export default parse;
}
