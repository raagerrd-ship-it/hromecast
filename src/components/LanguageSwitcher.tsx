import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 bg-muted rounded-full p-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 px-2.5 rounded-full text-xs font-medium transition-colors ${
          language === 'sv' 
            ? 'bg-background text-foreground shadow-sm' 
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => setLanguage('sv')}
      >
        SV
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 px-2.5 rounded-full text-xs font-medium transition-colors ${
          language === 'en' 
            ? 'bg-background text-foreground shadow-sm' 
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => setLanguage('en')}
      >
        EN
      </Button>
    </div>
  );
}
