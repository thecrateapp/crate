#include "crate_vdj/translations.hpp"

#include <algorithm>
#include <cctype>
#include <string>

namespace crate::vdj {
namespace {

struct PluginTranslations {
    std::string_view compatible_folder;
    std::string_view compatible_menu;
    std::string_view open_in_crate_menu;
    std::string_view playlists;
    std::string_view genres;
    std::string_view moods;
    std::string_view recently_played;
};

constexpr PluginTranslations kEnglishTranslations = {
    "Smart Mix compatible tracks",
    "Show compatible tracks",
    "Open in Crate",
    "Playlists",
    "Genres",
    "Moods",
    "Recently Played",
};

constexpr PluginTranslations kSpanishTranslations = {
    "Pistas compatibles de Smart Mix",
    "Mostrar pistas compatibles",
    "Abrir en Crate",
    "Listas de reproducción",
    "Géneros",
    "Estados de ánimo",
    "Reproducido recientemente",
};

const PluginTranslations& translations_for_language(
    std::string_view language
)
{
    return is_spanish_language(language)
        ? kSpanishTranslations
        : kEnglishTranslations;
}

} // namespace

bool is_spanish_language(std::string_view language)
{
    std::string normalized(language);
    std::transform(
        normalized.begin(),
        normalized.end(),
        normalized.begin(),
        [](unsigned char character) {
            return static_cast<char>(std::tolower(character));
        }
    );
    return normalized == "es" || normalized == "es-es" ||
           normalized == "es_es" || normalized == "español" ||
           normalized.starts_with("español ") ||
           normalized.starts_with("spanish");
}

std::string_view compatible_folder_label(std::string_view language)
{
    return translations_for_language(language).compatible_folder;
}

std::string_view compatible_menu_label(std::string_view language)
{
    return translations_for_language(language).compatible_menu;
}

std::string_view open_in_crate_menu_label(std::string_view language)
{
    return translations_for_language(language).open_in_crate_menu;
}

std::string_view catalog_folder_label(
    std::string_view folder_id,
    std::string_view fallback_name,
    std::string_view language
)
{
    const auto& translations = translations_for_language(language);
    if (folder_id == "crate:playlists") {
        return translations.playlists;
    }
    if (folder_id == "crate:genres") {
        return translations.genres;
    }
    if (folder_id == "crate:moods") {
        return translations.moods;
    }
    if (folder_id == "crate:recently-played") {
        return translations.recently_played;
    }
    return fallback_name;
}

} // namespace crate::vdj
