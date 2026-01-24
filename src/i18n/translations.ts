export type Language = 'sv' | 'en';

export const translations = {
  sv: {
    // Common
    back: 'Tillbaka',
    download: 'Ladda ner',
    downloading: 'Laddar ner...',
    loading: 'Laddar...',
    online: 'Online',
    offline: 'Offline',
    testing: 'Testar...',
    testConnection: 'Testa anslutning',
    tryAgain: 'Testa igen',
    latestVersion: 'Senaste version',
    latest: 'Senaste',
    
    // Index page
    heroTitle: 'Chromecast Screensaver',
    heroDescription: 'Visar automatiskt en webbsida på din Chromecast när den är inaktiv',
    heroDescriptionSub: '– perfekt som digital skyltning, dashboard eller bildspel',
    getStarted: 'Kom igång på 2 minuter',
    getStartedDesc: 'Ladda ner och installera bridge-tjänsten på din dator',
    step1: 'Ladda ner bridge-paketet',
    step2: 'Packa upp och kör installern',
    step3Open: 'Öppna',
    downloadForPlatforms: 'Ladda ner för Windows / Linux',
    detailedInstructions: 'Detaljerade instruktioner',
    alreadyInstalled: 'Redan installerat?',
    openLocalDashboard: 'Öppna din lokala dashboard direkt',
    runsLocally: 'Körs lokalt • Ingen molnanslutning',
    
    // Setup page
    installGuide: 'Installationsguide',
    downloadStep: 'Ladda ner',
    containsEverything: 'Innehåller allt du behöver',
    installStep: 'Installera',
    configureStep: 'Öppna & konfigurera',
    
    // Windows instructions
    unzipFile: 'Packa upp zip-filen',
    rightClickPowershell: 'Högerklicka på',
    runWithPowershell: 'Välj "Kör med PowerShell som administratör"',
    done: 'Klart! Bridge startar automatiskt',
    windowsTip: 'Scriptet installerar Node.js automatiskt om det saknas och skapar autostart vid systemstart.',
    
    // Linux instructions
    unzipAndOpenTerminal: 'Packa upp och öppna en terminal i mappen',
    runInstallScript: 'Kör installationsscriptet:',
    doneLinux: 'Klart! Startar automatiskt vid inloggning',
    linuxTip: 'Skapar en systemd user service. Kontrollera status med:',
    
    // Raspberry Pi instructions
    copyZipToRpi: 'Kopiera zip-filen till din Raspberry Pi',
    viaUsb: 'Via USB, SCP eller SFTP',
    unzipAndRun: 'Packa upp och kör:',
    doneRpi: 'Klart! Perfekt som always-on bridge',
    rpiTip: 'Raspberry Pi är perfekt som dedikerad bridge eftersom den är tyst och drar lite ström.',
    
    // Configure step
    openInBrowser: 'Öppna i webbläsaren:',
    inBridgeInterface: 'I bridge-gränssnittet:',
    selectChromecast: 'Välj din Chromecast från listan',
    enterUrl: 'Ange URL till din screensaver',
    activateAndTest: 'Aktivera och testa!',
    
    // FAQ
    faq: 'Vanliga frågor',
    faqMultipleBridges: 'Kan jag köra flera bridges?',
    faqMultipleBridgesAnswer1: 'Ja! Varje bridge har sin egen konfiguration.',
    faqMultipleBridgesSameComputer: 'Samma dator:',
    faqMultipleBridgesSameComputerAnswer: 'Kör installern igen med unikt namn + port',
    faqMultipleBridgesDifferent: 'Olika datorer:',
    faqMultipleBridgesDifferentAnswer: 'Installera på varje dator',
    faqMultipleBridgesExample: 'Exempel: Vardagsrum :3000, Sovrum :3001, Kök :3002',
    faqNoChromecast: 'Hittar ingen Chromecast',
    faqNoChromecastAnswer: 'Kontrollera att Chromecast och datorn är på samma nätverk. Klicka "Sök" i bridge-gränssnittet för att söka igen.',
    faqLocalhostNotLoading: 'Sidan localhost:3000 laddas inte',
    faqLocalhostNotLoadingAnswer: 'Kontrollera att bridge-tjänsten körs:',
    faqLocalhostWindows: 'Tryck',
    faqLocalhostWindowsWrite: 'skriv',
    faqLocalhostWindowsEnter: 'och tryck Enter. Kontrollera att "ChromecastBridge" finns i listan.',
    faqUninstall: 'Hur avinstallerar jag?',
    faqUninstallAnswer: 'Kör avinstallationsscriptet:',
    
    // Changelog
    changelog: 'Ändringslogg',
    
    // Manual install
    manualInstall: 'Manuell installation (avancerat)',
    installNodejs: 'Installera Node.js 18+',
    downloadFromNodejs: 'Ladda ner från nodejs.org',
    installDependencies: 'Installera dependencies',
    createEnvFile: 'Skapa .env-fil',
    start: 'Starta',
    
    // Toast messages
    bridgeOnline: 'Bridge är igång! ✓',
    deviceId: 'Device ID:',
    unknown: 'okänt',
    bridgeNotResponding: 'Bridge svarar inte korrekt',
    serverError: 'Servern svarade men returnerade ett fel.',
    couldNotConnect: 'Kunde inte ansluta till bridge',
    checkBridgeRunning: 'Kontrollera att bridge körs på localhost:3000',
  },
  en: {
    // Common
    back: 'Back',
    download: 'Download',
    downloading: 'Downloading...',
    loading: 'Loading...',
    online: 'Online',
    offline: 'Offline',
    testing: 'Testing...',
    testConnection: 'Test connection',
    tryAgain: 'Try again',
    latestVersion: 'Latest version',
    latest: 'Latest',
    
    // Index page
    heroTitle: 'Chromecast Screensaver',
    heroDescription: 'Automatically displays a webpage on your Chromecast when idle',
    heroDescriptionSub: '– perfect for digital signage, dashboards or slideshows',
    getStarted: 'Get started in 2 minutes',
    getStartedDesc: 'Download and install the bridge service on your computer',
    step1: 'Download the bridge package',
    step2: 'Extract and run the installer',
    step3Open: 'Open',
    downloadForPlatforms: 'Download for Windows / Linux',
    detailedInstructions: 'Detailed instructions',
    alreadyInstalled: 'Already installed?',
    openLocalDashboard: 'Open your local dashboard directly',
    runsLocally: 'Runs locally • No cloud connection',
    
    // Setup page
    installGuide: 'Installation Guide',
    downloadStep: 'Download',
    containsEverything: 'Contains everything you need',
    installStep: 'Install',
    configureStep: 'Open & configure',
    
    // Windows instructions
    unzipFile: 'Extract the zip file',
    rightClickPowershell: 'Right-click on',
    runWithPowershell: 'Select "Run with PowerShell as administrator"',
    done: 'Done! Bridge starts automatically',
    windowsTip: 'The script automatically installs Node.js if missing and sets up autostart on system boot.',
    
    // Linux instructions
    unzipAndOpenTerminal: 'Extract and open a terminal in the folder',
    runInstallScript: 'Run the installation script:',
    doneLinux: 'Done! Starts automatically on login',
    linuxTip: 'Creates a systemd user service. Check status with:',
    
    // Raspberry Pi instructions
    copyZipToRpi: 'Copy the zip file to your Raspberry Pi',
    viaUsb: 'Via USB, SCP or SFTP',
    unzipAndRun: 'Extract and run:',
    doneRpi: 'Done! Perfect as always-on bridge',
    rpiTip: 'Raspberry Pi is perfect as a dedicated bridge since it\'s quiet and energy efficient.',
    
    // Configure step
    openInBrowser: 'Open in browser:',
    inBridgeInterface: 'In the bridge interface:',
    selectChromecast: 'Select your Chromecast from the list',
    enterUrl: 'Enter the URL for your screensaver',
    activateAndTest: 'Activate and test!',
    
    // FAQ
    faq: 'FAQ',
    faqMultipleBridges: 'Can I run multiple bridges?',
    faqMultipleBridgesAnswer1: 'Yes! Each bridge has its own configuration.',
    faqMultipleBridgesSameComputer: 'Same computer:',
    faqMultipleBridgesSameComputerAnswer: 'Run the installer again with unique name + port',
    faqMultipleBridgesDifferent: 'Different computers:',
    faqMultipleBridgesDifferentAnswer: 'Install on each computer',
    faqMultipleBridgesExample: 'Example: Living room :3000, Bedroom :3001, Kitchen :3002',
    faqNoChromecast: 'Cannot find Chromecast',
    faqNoChromecastAnswer: 'Make sure the Chromecast and computer are on the same network. Click "Search" in the bridge interface to search again.',
    faqLocalhostNotLoading: 'The page localhost:3000 won\'t load',
    faqLocalhostNotLoadingAnswer: 'Check that the bridge service is running:',
    faqLocalhostWindows: 'Press',
    faqLocalhostWindowsWrite: 'type',
    faqLocalhostWindowsEnter: 'and press Enter. Check that "ChromecastBridge" is in the list.',
    faqUninstall: 'How do I uninstall?',
    faqUninstallAnswer: 'Run the uninstall script:',
    
    // Changelog
    changelog: 'Changelog',
    
    // Manual install
    manualInstall: 'Manual installation (advanced)',
    installNodejs: 'Install Node.js 18+',
    downloadFromNodejs: 'Download from nodejs.org',
    installDependencies: 'Install dependencies',
    createEnvFile: 'Create .env file',
    start: 'Start',
    
    // Toast messages
    bridgeOnline: 'Bridge is running! ✓',
    deviceId: 'Device ID:',
    unknown: 'unknown',
    bridgeNotResponding: 'Bridge not responding correctly',
    serverError: 'The server responded but returned an error.',
    couldNotConnect: 'Could not connect to bridge',
    checkBridgeRunning: 'Make sure the bridge is running on localhost:3000',
  },
} as const;

export type TranslationKey = keyof typeof translations.sv;
