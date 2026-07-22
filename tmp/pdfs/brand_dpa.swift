import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import PDFKit

guard CommandLine.arguments.count == 4 else {
  fputs("Usage: brand_dpa.swift INPUT_PDF LOGO_PNG OUTPUT_PDF\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let logoURL = URL(fileURLWithPath: CommandLine.arguments[2])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])

guard
  let source = CGPDFDocument(inputURL as CFURL),
  let logoSource = CGImageSourceCreateWithURL(logoURL as CFURL, nil),
  let logo = CGImageSourceCreateImageAtIndex(logoSource, 0, nil),
  let firstPage = source.page(at: 1)
else {
  fputs("Could not open the source PDF or Triven logo\n", stderr)
  exit(1)
}

try FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(),
  withIntermediateDirectories: true
)

var mediaBox = firstPage.getBoxRect(.mediaBox)
let metadata = [
  kCGPDFContextTitle as String: "Triven Data Processing Agreement",
  kCGPDFContextAuthor as String: "Triven.ai, Inc.",
  kCGPDFContextSubject as String: "Data Processing Agreement",
  kCGPDFContextCreator as String: "Triven.ai Legal & Compliance"
] as CFDictionary

guard
  let consumer = CGDataConsumer(url: outputURL as CFURL),
  let context = CGContext(consumer: consumer, mediaBox: &mediaBox, metadata)
else {
  fputs("Could not create the branded PDF\n", stderr)
  exit(1)
}

let orange = CGColor(red: 245.0 / 255.0, green: 158.0 / 255.0, blue: 11.0 / 255.0, alpha: 1)

func drawText(
  _ text: String,
  at point: CGPoint,
  size: CGFloat,
  color: CGColor,
  fontName: String = "Helvetica-Bold"
) {
  let font = CTFontCreateWithName(fontName as CFString, size, nil)
  let attributedText = NSAttributedString(
    string: text,
    attributes: [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): color
    ]
  )
  let line = CTLineCreateWithAttributedString(attributedText)
  context.saveGState()
  context.textMatrix = .identity
  context.textPosition = point
  CTLineDraw(line, context)
  context.restoreGState()
}

func tint(_ rect: CGRect) {
  context.saveGState()
  context.setBlendMode(.color)
  context.setFillColor(orange)
  context.fill(rect)
  context.restoreGState()
}

func drawContinuationBrand(pageHeight: CGFloat) {
  let markHeight: CGFloat = 10
  let markWidth = markHeight * CGFloat(logo.width) / CGFloat(logo.height)
  context.draw(logo, in: CGRect(x: 42, y: pageHeight - 25, width: markWidth, height: markHeight))
  drawText("TRIVEN", at: CGPoint(x: 57, y: pageHeight - 24), size: 8.5, color: orange)
}

for pageNumber in 1...source.numberOfPages {
  guard let page = source.page(at: pageNumber) else { continue }
  let pageBox = page.getBoxRect(.mediaBox)
  let pageInfo = [kCGPDFContextMediaBox as String: pageBox] as CFDictionary

  context.beginPDFPage(pageInfo)
  context.saveGState()
  context.drawPDFPage(page)
  context.restoreGState()

  if pageNumber == 1 {
    // Replace only the original text-only brand with the Triven mark and orange wordmark.
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 39, y: 775, width: 101, height: 27))

    let markHeight: CGFloat = 19
    let markWidth = markHeight * CGFloat(logo.width) / CGFloat(logo.height)
    context.draw(logo, in: CGRect(x: 42, y: 779, width: markWidth, height: markHeight))
    drawText("TRIVEN", at: CGPoint(x: 70, y: 781), size: 17, color: orange)

    // Recolor the existing title without replacing or reflowing its text.
    tint(CGRect(x: 41, y: 749, width: 252, height: 21))
  } else {
    drawContinuationBrand(pageHeight: pageBox.height)
  }

  if pageNumber == 2 {
    // Match the Google Limited Use callout to the Triven theme.
    tint(CGRect(x: 41, y: 106, width: 513, height: 56))
  }

  if pageNumber == 3 {
    // Match the pre-signed customer acceptance panel to the Triven theme.
    tint(CGRect(x: 321, y: 466, width: 234, height: 89))
  }

  context.endPDFPage()
}

context.closePDF()

// Reapply the source document's email links, which are stored as annotations.
if
  let sourceDocument = PDFDocument(url: inputURL),
  let outputDocument = PDFDocument(url: outputURL)
{
  for pageIndex in 0..<min(sourceDocument.pageCount, outputDocument.pageCount) {
    guard
      let sourcePage = sourceDocument.page(at: pageIndex),
      let outputPage = outputDocument.page(at: pageIndex)
    else { continue }

    for sourceAnnotation in sourcePage.annotations where sourceAnnotation.type == PDFAnnotationSubtype.link.rawValue {
      guard let url = sourceAnnotation.url else { continue }
      let annotation = PDFAnnotation(bounds: sourceAnnotation.bounds, forType: .link, withProperties: nil)
      annotation.url = url
      outputPage.addAnnotation(annotation)
    }
  }

  guard outputDocument.write(to: outputURL) else {
    fputs("Could not preserve the source PDF links\n", stderr)
    exit(1)
  }
}

print("saved=\(outputURL.path) pages=\(source.numberOfPages)")
