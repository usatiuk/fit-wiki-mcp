export function makeTestPdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObject = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjects: number[] = [];
  for (const text of pages) {
    const content = `BT /F1 24 Tf 72 720 Td (${escapePdfString(text)}) Tj ET`;
    const streamObject = addObject(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    pageObjects.push(
      addObject(
        `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${streamObject} 0 R >>`
      )
    );
  }

  const pagesObject = addObject(
    `<< /Type /Pages /Kids [${pageObjects.map((object) => `${object} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`
  );
  for (const pageObject of pageObjects) {
    objects[pageObject - 1] = objects[pageObject - 1]?.replace("/Parent 0 0 R", `/Parent ${pagesObject} 0 R`) ?? "";
  }

  const infoObject = addObject(
    "<< /Title (Fit Wiki Test PDF) /Author (fit-wiki-mcp tests) /Creator (fixture-generator) /Producer (fit-wiki-mcp) >>"
  );
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R /Info ${infoObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function escapePdfString(value: string): string {
  return value.replace(/[\\()]/g, "\\$&");
}
