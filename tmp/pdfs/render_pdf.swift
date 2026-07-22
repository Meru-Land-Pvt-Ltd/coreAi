import AppKit
import Foundation
import PDFKit

guard CommandLine.arguments.count >= 3 else {
  fputs("Usage: render_pdf.swift INPUT_PDF OUTPUT_DIR\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

guard let document = PDFDocument(url: inputURL) else {
  fputs("Could not open PDF\n", stderr)
  exit(1)
}

print("pages=\(document.pageCount)")
print("title=\(document.documentAttributes?[PDFDocumentAttribute.titleAttribute] ?? "")")

for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let targetSize = NSSize(width: bounds.width * 2, height: bounds.height * 2)
  let image = page.thumbnail(of: targetSize, for: .mediaBox)
  guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
  else {
    fputs("Could not render page \(index + 1)\n", stderr)
    exit(1)
  }

  let outputFile = outputURL.appendingPathComponent(String(format: "page-%02d.png", index + 1))
  try png.write(to: outputFile)
  print("page=\(index + 1) size=\(bounds.width)x\(bounds.height) annotations=\(page.annotations.count)")
  for annotation in page.annotations {
    print("annotation=\(index + 1) type=\(annotation.type ?? "unknown") bounds=\(annotation.bounds) url=\(annotation.url?.absoluteString ?? "")")
  }
  print("--- PAGE \(index + 1) TEXT ---")
  print(page.string ?? "")
}
