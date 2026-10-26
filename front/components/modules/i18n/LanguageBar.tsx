import LanguageSwitcher from "./LanguageSwitcher";
import styles from "./language-bar.module.scss";

// Selector de idioma alineado a la derecha, para layouts que no usan el Header de la tienda
export default function LanguageBar() {
    return (
        <div className={styles.bar}>
            <LanguageSwitcher />
        </div>
    );
}
