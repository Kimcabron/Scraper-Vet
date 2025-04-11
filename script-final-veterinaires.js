/**
 * Script pour collecter les données des vétérinaires en Suisse romande
 * Utilise Puppeteer pour naviguer sur search.ch et extraire les informations
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Liste des cantons de Suisse romande
const CANTONS_SUISSE_ROMANDE = ['Vaud', 'Genève', 'Neuchâtel', 'Jura', 'Fribourg', 'Valais'];

// Structure pour stocker les données
let allVeterinaires = [];

/**
 * Fonction principale qui coordonne le scraping
 */
async function main() {
  console.log('Démarrage de la collecte des données des vétérinaires en Suisse romande...');
  
  const browser = await puppeteer.launch({ 
    headless: false, // Mettre à true pour une exécution sans interface graphique
    defaultViewport: null,
    args: ['--start-maximized'] 
  });
  
  try {
    const page = await browser.newPage();
    
    // Accepter les cookies une seule fois
    await page.goto('https://tel.search.ch/');
    await acceptCookies(page);
    
    // Parcourir chaque canton
    for (const canton of CANTONS_SUISSE_ROMANDE) {
      console.log(`Collecte des données pour le canton: ${canton}`);
      
      // Collecter les données pour ce canton
      const cantonsData = await collectDataForCanton(page, canton);
      allVeterinaires = [...allVeterinaires, ...cantonsData];
      
      console.log(`${cantonsData.length} vétérinaires trouvés pour ${canton}`);
    }
    
    // Convertir en CSV et enregistrer
    const csvContent = convertToCSV(allVeterinaires);
    const outputPath = path.join(__dirname, 'veterinaires_suisse_romande.csv');
    fs.writeFileSync(outputPath, csvContent, 'utf8');
    
    console.log(`Données sauvegardées dans: ${outputPath}`);
    console.log(`Total: ${allVeterinaires.length} vétérinaires collectés`);
    
  } catch (error) {
    console.error('Une erreur est survenue:', error);
  } finally {
    await browser.close();
  }
}

/**
 * Accepte les cookies sur la page
 */
async function acceptCookies(page) {
  try {
    // Attendre que le bouton d'acceptation des cookies apparaisse
    await page.waitForSelector("button", { timeout: 5000 });
    
    // Trouver et cliquer sur le bouton d'acceptation
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const acceptButton = buttons.find(button => 
        button.textContent.includes("J'accepte")
      );
      if (acceptButton) acceptButton.click();
    });
    
    // Attendre que la bannière disparaisse
    await page.waitForTimeout(1000);
    
  } catch (error) {
    console.log('Pas de bannière de cookies détectée ou déjà acceptée');
  }
}

/**
 * Collecte les données pour un canton spécifique
 */
async function collectDataForCanton(page, canton) {
  const veterinaires = [];
  let hasNextPage = true;
  let pageNum = 1;
  
  while (hasNextPage) {
    // Construire l'URL de recherche avec pagination
    const searchUrl = `https://tel.search.ch/recherche?was=v%C3%A9t%C3%A9rinaire&wo=${encodeURIComponent(canton)}&page=${pageNum}`;
    
    // Naviguer vers la page de résultats
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    
    // Extraire les données des résultats
    const pageData = await extractDataFromPage(page, canton);
    veterinaires.push(...pageData);
    
    // Vérifier s'il y a une page suivante
    hasNextPage = await hasNextPageAvailable(page);
    
    if (hasNextPage) {
      pageNum++;
      // Pause pour éviter de surcharger le serveur
      await page.waitForTimeout(1000);
    }
  }
  
  return veterinaires;
}

/**
 * Extrait les données de la page de résultats courante
 */
async function extractDataFromPage(page, currentCanton) {
  // Attendre que les résultats soient chargés
  await page.waitForSelector('.entry, .card-info', { timeout: 5000 }).catch(() => {});
  
  // Extraire les données
  return await page.evaluate((canton) => {
    const results = Array.from(document.querySelectorAll('.entry, .card-info'));
    return results.map(result => {
      // Trouver les éléments contenant les informations
      const nameElem = result.querySelector('h2, .title, .name');
      const addressElems = result.querySelectorAll('address div, .address');
      const phoneElem = result.querySelector('a[href^="tel:"], .phone');
      const emailElem = result.querySelector('a[href^="mailto:"], .email');
      const webElem = result.querySelector('a.website, a[href^="http"]:not([href^="mailto:"]):not([href^="tel:"])');
      const categoryElem = result.querySelector('.category, .categories');
      
      // Extraire les valeurs
      const nom = nameElem ? nameElem.textContent.trim() : '';
      
      // Assembler l'adresse à partir de plusieurs éléments si nécessaire
      let adresse = '';
      if (addressElems.length > 0) {
        for (const elem of addressElems) {
          adresse += elem.textContent.trim() + ' ';
        }
        adresse = adresse.trim();
      }
      
      const telephone = phoneElem ? 
        phoneElem.getAttribute('href') ? 
          phoneElem.getAttribute('href').replace('tel:', '') : 
          phoneElem.textContent.trim() : 
        '';
      
      const email = emailElem ? 
        emailElem.getAttribute('href') ? 
          emailElem.getAttribute('href').replace('mailto:', '') : 
          emailElem.textContent.trim() : 
        '';
      
      const siteWeb = webElem ? webElem.getAttribute('href') || '' : '';
      
      const specialite = categoryElem ? categoryElem.textContent.trim() : '';
      
      return {
        nom,
        adresse,
        telephone,
        email,
        siteWeb,
        specialite,
        canton
      };
    }).filter(item => item.nom && item.nom.length > 0); // Filtrer les résultats vides
  }, currentCanton);
}

/**
 * Vérifie s'il y a une page suivante dans les résultats
 */
async function hasNextPageAvailable(page) {
  return await page.evaluate(() => {
    const nextButton = document.querySelector('a.next, a[aria-label="Page suivante"]');
    return nextButton !== null;
  });
}

/**
 * Convertit les données en format CSV
 */
function convertToCSV(data) {
  const headers = ['Nom', 'Adresse', 'Téléphone', 'Email', 'Site Web', 'Spécialité', 'Canton'];
  const csvRows = [];
  
  // Ajouter les en-têtes
  csvRows.push(headers.join(','));
  
  // Ajouter les données
  for (const item of data) {
    const values = [
      `"${(item.nom || '').replace(/"/g, '""')}"`,
      `"${(item.adresse || '').replace(/"/g, '""')}"`,
      `"${(item.telephone || '').replace(/"/g, '""')}"`,
      `"${(item.email || '').replace(/"/g, '""')}"`,
      `"${(item.siteWeb || '').replace(/"/g, '""')}"`,
      `"${(item.specialite || '').replace(/"/g, '""')}"`,
      `"${(item.canton || '').replace(/"/g, '""')}"`
    ];
    
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

// Lancer le programme
main().catch(console.error);