const textArea = document.getElementById("text");
const titleInput = document.getElementById("title");
const authorInput = document.getElementById("author");
const fontFamilySelect = document.getElementById("fontFamily");
const fontSizeInput = document.getElementById("fontSize");
const lineHeightSelect = document.getElementById("lineHeight");
const lineWidthSlider = document.getElementById("lineWidth");
const lineWidthValue = document.getElementById("lineWidthValue");
const countTitleWordsCheckbox = document.getElementById("countTitleWords");
const wordCountDisplay = document.getElementById("wordCount");
const previewTitle = document.getElementById("previewTitle");
const previewTitleCount = document.getElementById("previewTitleCount");
const previewAuthor = document.getElementById("previewAuthor");
const previewWordCount = document.getElementById("previewWordCount");
const toolbarFont = document.getElementById("toolbarFont");
const toolbarSize = document.getElementById("toolbarSize");

// --- Constantes partagées (aperçu + PDF) ---
// Marge de sécurité pour éviter les débordements
const SAFETY_MARGIN = 1.0;
// Largeur utile d'une page A4 avec marges 20mm : 210 - 20 - 20 = 170mm
// Répartition de la zone de lecture : repère de ligne / texte / compteur de mots
const PDF_LINE_NUMBER_COLUMN_WIDTH_MM = 170 * 0.02;
const PDF_TEXT_COLUMN_WIDTH_MM = 170 * 0.95;
const PDF_WORD_COUNT_COLUMN_WIDTH_MM = 170 * 0.03;
// Conversion mm → pixels CSS (96 dpi)
const MM_TO_PX = 96 / 25.4;
// Correspondance polices navigateur → jsPDF (avec avertissement si substitution)
const PDF_FONT_MAP = {
  Arial: { pdfName: "helvetica", warning: null },
  "Times New Roman": { pdfName: "times", warning: null },
  "Courier New": { pdfName: "courier", warning: null },
  Georgia: {
    pdfName: "times",
    warning: "Georgia non disponible en PDF → Times New Roman utilisé.",
  },
  Verdana: {
    pdfName: "helvetica",
    warning: "Verdana non disponible en PDF → Helvetica utilisé.",
  },
  "BelleAllureCM-Fin": {
    pdfName: "BelleAllureCM-Fin",
    warning: null,
    custom: true,
  },
  "BelleAllureCM-Gros": {
    pdfName: "BelleAllureCM-Gros",
    warning: null,
    custom: true,
  },
};

// Compte les mots d'un texte.
// Règle : seuls les espaces séparent les mots.
// Les tirets NE séparent PAS les mots ("Haute-Savoie" = 1 mot).
// La ponctuation seule (« » : ; ! ? , …) n'est pas comptée.
function countWords(text) {
  text = text.trim();
  if (text === "") return 0;
  const words = text.split(/\s+/).filter((word) => {
    if (word.length === 0) return false;
    const withoutPunctuation = word.replace(/[«»""'',;:!?.…\-]/g, "");
    return withoutPunctuation.length > 0;
  });
  return words.length;
}

// Mesure la largeur d'un texte en pixels CSS via un canvas
function getTextWidth(text, font, fontSize) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${fontSize}pt ${font}`;
  return context.measureText(text).width;
}

// Découpe un paragraphe en lignes selon une largeur maximale en mm
function wrapTextByWidth(text, font, fontSize, maxWidthMm) {
  // On découpe par espaces uniquement : "Haute-Savoie" reste en un seul mot
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines = [];
  let currentLine = "";

  // Conversion mm → pixels CSS (96 dpi, correspondant au rendu canvas)
  const maxWidthPixels = maxWidthMm * MM_TO_PX;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? currentLine + " " + word : word;
    const testWidth = getTextWidth(testLine, font, fontSize);

    if (testWidth <= maxWidthPixels) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Mot seul trop long : on le force quand même (évite boucle infinie)
        lines.push(word);
        currentLine = "";
      }
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

// Construit le tableau de lignes avec comptage cumulatif.
// Utilisé à la fois par updatePreview() et generatePdf() pour garantir
// la cohérence aperçu ↔ PDF.
// Les paragraphes vides sont conservés comme séparateurs visuels,
// mais ils ne font pas avancer le compteur de mots ni les repères de ligne.
function buildLineData(text, font, fontSize, lineWidthPercent) {
  const maxTextWidth =
    PDF_TEXT_COLUMN_WIDTH_MM * (lineWidthPercent / 100) * SAFETY_MARGIN;
  const rawLines = text.split("\n");
  const allLines = [];

  rawLines.forEach((paragraph) => {
    if (paragraph.trim().length === 0) {
      allLines.push({ text: "", blank: true, words: 0, cumulative: null });
      return;
    }

    const wrapped = wrapTextByWidth(paragraph, font, fontSize, maxTextWidth);
    wrapped.forEach((line) => {
      allLines.push({ text: line, blank: false, words: 0, cumulative: null });
    });
  });

  let cumulativeWords = 0;
  return allLines.map((line) => {
    if (!line.blank) {
      line.words = countWords(line.text);
      cumulativeWords += line.words;
      line.cumulative = line.words > 0 ? cumulativeWords : null;
    }

    return {
      text: line.text,
      blank: line.blank,
      words: line.words,
      cumulative: line.cumulative,
    };
  });
}

function getLineMarker(lineIndex) {
  const lineNumber = lineIndex + 1;
  return lineNumber % 5 === 0 ? lineNumber : "";
}

// Met à jour l'aperçu en temps réel
function updatePreview() {
  const text = textArea.value;
  const title = titleInput.value || "Texte de Fluence";
  const author = authorInput.value;
  const font = fontFamilySelect.value;
  const fontSize = parseInt(fontSizeInput.value);
  const lineHeight = parseFloat(lineHeightSelect.value);
  const lineWidthPercent = parseInt(lineWidthSlider.value);
  const countTitleWords = countTitleWordsCheckbox.checked;
  const titleWords = countWords(title);
  const totalWords = countWords(text);
  const totalWordsWithTitle = totalWords + (countTitleWords ? titleWords : 0);

  // Synchroniser les indicateurs de la toolbar (lecture seule)
  toolbarFont.textContent = font;
  toolbarSize.textContent = fontSize + " pt";

  // Synchroniser l'affichage du slider (un seul écouteur suffit)
  lineWidthValue.textContent = lineWidthPercent;

  // Mettre à jour le titre
  previewTitle.textContent = title;
  previewTitle.style.fontFamily = font;
  previewTitle.style.color = "#d97706";
  previewTitleCount.textContent = countTitleWords ? titleWords : "\u00a0";

  // Mettre à jour l'auteur
  if (author) {
    previewAuthor.textContent = author;
    previewAuthor.style.display = "block";
    previewAuthor.style.fontFamily = font;
  } else {
    previewAuthor.style.display = "none";
  }

  // Mettre à jour le compteur
  wordCountDisplay.textContent = totalWords;
  previewWordCount.textContent = totalWordsWithTitle;

  // Générer les lignes avec comptage cumulatif
  const lineData = buildLineData(text, font, fontSize, lineWidthPercent);

  // Afficher chaque ligne avec son numéro
  const textDisplay = document.querySelector(".text-display");
  textDisplay.style.fontFamily = font;
  textDisplay.style.fontSize = fontSize + "pt";
  textDisplay.style.lineHeight = lineHeight;

  const cumulativeOffset = countTitleWords ? titleWords : 0;

  let visibleLineIndex = 0;
  const linesHtml = lineData
    .map(
      (data) => `
        <div class="line-row" style="font-family: ${font}; font-size: ${fontSize}pt; line-height: ${lineHeight};">
            <div class="line-number-column">
                <span class="line-number">${data.blank ? "&nbsp;" : getLineMarker(visibleLineIndex++) || "&nbsp;"}</span>
            </div>
            <div class="text-column">
                <span class="text-line">${data.text || "&nbsp;"}</span>
            </div>
            <div class="numbers-column">
          <span class="number-line">${data.cumulative !== null ? data.cumulative + cumulativeOffset : "&nbsp;"}</span>
            </div>
        </div>
    `,
    )
    .join("");

  textDisplay.innerHTML = linesHtml;
}

// Initialiser l'aperçu
updatePreview();

// Écouter tous les changements (le slider n'a plus qu'un seul listener)
textArea.addEventListener("input", updatePreview);
titleInput.addEventListener("input", updatePreview);
authorInput.addEventListener("input", updatePreview);
fontFamilySelect.addEventListener("change", updatePreview);
fontSizeInput.addEventListener("change", updatePreview);
lineHeightSelect.addEventListener("change", updatePreview);
lineWidthSlider.addEventListener("input", updatePreview);
countTitleWordsCheckbox.addEventListener("change", updatePreview);

// Génère et télécharge le PDF
async function generatePdf() {
  const btn = document.querySelector(".btn-pdf");
  try {
    const text = textArea.value.trim();
    if (!text) {
      alert("Veuillez saisir un texte avant de générer le PDF.");
      return;
    }

    const title = titleInput.value || "Texte de Fluence";

    btn.disabled = true;
    btn.textContent = "⏳ Génération...";

    // Mode WYSIWYG: le PDF est une capture fidèle de la preview.
    updatePreview();
    await generatePdfFromCanvas(title);
  } catch (err) {
    console.error("Erreur lors de la génération du PDF :", err);
    alert(
      "Une erreur est survenue lors de la génération du PDF.\nVérifiez la console pour plus de détails.",
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "📑 Générer le PDF";
  }
}

// Génère le PDF en capturant l'aperçu avec html2canvas.
// Ce mode est utilisé pour toutes les polices afin de garantir un rendu WYSIWYG.
async function generatePdfFromCanvas(title) {
  const previewPage = document.querySelector(".preview-page");

  // Attend le chargement des polices pour limiter les écarts preview/PDF.
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const canvas = await html2canvas(previewPage, {
    scale: 2, // résolution ×2 pour une impression nette
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const pageW = 210; // mm — largeur A4
  const pageH = 297; // mm — hauteur A4
  const imgH = (canvas.height / canvas.width) * pageW; // hauteur totale de l'image en mm
  const MIN_REMAINDER_MM = 0.5;

  // Découper l'image en pages de 297 mm
  let sliceTop = 0;
  let page = 0;
  while (sliceTop < imgH - MIN_REMAINDER_MM) {
    if (page > 0) doc.addPage();
    // positionner l'image de façon à afficher la tranche courante
    doc.addImage(imgData, "JPEG", 0, -sliceTop, pageW, imgH);
    sliceTop += pageH;
    page++;
  }

  doc.save(`${title.replace(/[^a-z0-9]/gi, "_")}_fluence.pdf`);
}

// Génère le PDF en mode texte vectoriel avec jsPDF.
// Utilisé pour les polices standard (Helvetica, Times, Courier).
function generatePdfText(title, font, pdfFont) {
  const author = authorInput.value;
  const fontSize = parseInt(fontSizeInput.value);
  const lineHeight = parseFloat(lineHeightSelect.value);
  const lineWidthPercent = parseInt(lineWidthSlider.value);
  const countTitleWords = countTitleWordsCheckbox.checked;
  const titleWords = countWords(title);
  const totalWords = countWords(textArea.value);
  const totalWordsWithTitle = totalWords + (countTitleWords ? titleWords : 0);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  let yPos = 20;
  const leftMargin = 20;
  const rightMargin = 190;
  const textStartX = leftMargin + PDF_LINE_NUMBER_COLUMN_WIDTH_MM + 1.8;
  const lineNumberX = textStartX - 2.0;
  const counterBlue = [23, 61, 138];
  const guideBlue = [155, 188, 255];
  const guideX = rightMargin - 7.6;

  // Titre
  doc.setFontSize(16);
  doc.setFont(pdfFont, "bold");
  doc.setTextColor(217, 119, 6);
  doc.text(title, leftMargin, yPos);

  if (countTitleWords) {
    doc.setTextColor(...counterBlue);
    doc.setFontSize(10);
    doc.text(String(titleWords), rightMargin, yPos, { align: "right" });
  }

  doc.setTextColor(0, 0, 0);
  yPos += 10;

  // Générer les lignes avec le même algorithme que l'aperçu
  const lineData = buildLineData(
    textArea.value,
    font,
    fontSize,
    lineWidthPercent,
  );

  doc.setFontSize(fontSize);
  doc.setFont(pdfFont, "normal");

  // Conversion pt → mm : 1pt = 0.3528mm
  const lineSpacing = fontSize * lineHeight * 0.3528;
  const cumulativeOffset = countTitleWords ? titleWords : 0;

  function drawGuideLine(fromY, toY) {
    if (toY <= fromY) return;
    doc.setDrawColor(...guideBlue);
    doc.setLineWidth(0.2);
    doc.line(guideX, fromY, guideX, toY);
  }

  doc.setFontSize(fontSize);
  let pageGuideStartY = yPos - lineSpacing * 0.75;

  let visibleLineIndex = 0;
  lineData.forEach((data) => {
    if (yPos > 270) {
      drawGuideLine(pageGuideStartY, yPos - lineSpacing * 0.25);
      doc.addPage();
      yPos = 20;
      pageGuideStartY = yPos - lineSpacing * 0.75;
    }

    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    const lineMarker = data.blank
      ? ""
      : getLineMarker(visibleLineIndex++).toString();
    doc.text(lineMarker, lineNumberX, yPos, {
      align: "right",
      baseline: "alphabetic",
    });
    doc.setTextColor(0, 0, 0);

    doc.setFont(pdfFont, "normal");
    doc.setFontSize(fontSize);
    doc.text(data.text || "", textStartX, yPos);

    if (data.cumulative !== null) {
      doc.setTextColor(...counterBlue);
      doc.setFontSize(10);
      doc.text(String(data.cumulative + cumulativeOffset), rightMargin, yPos, {
        align: "right",
      });
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(fontSize);
    }

    yPos += lineSpacing;
  });

  drawGuideLine(pageGuideStartY, yPos - lineSpacing * 0.25);

  yPos += 5;

  // Auteur
  if (author) {
    if (yPos > 270) {
      doc.addPage();
      yPos = 20;
    }
    doc.setFont(pdfFont, "italic");
    doc.text(author, leftMargin, yPos);
    yPos += 10;
    doc.setFont(pdfFont, "normal");
  }

  // Champs de bilan
  if (yPos > 260) {
    doc.addPage();
    yPos = 20;
  }
  yPos += 5;
  doc.setFontSize(11);
  doc.text("Nombre de mots lus correctement : ___________", leftMargin, yPos);
  yPos += 7;
  doc.text(
    `Nombre de mots du texte : ${totalWordsWithTitle}`,
    leftMargin,
    yPos,
  );

  doc.save(`${title.replace(/[^a-z0-9]/gi, "_")}_fluence.pdf`);
}
