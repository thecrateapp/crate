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
    std::string_view aggressive;
    std::string_view dark;
    std::string_view happy;
    std::string_view party;
    std::string_view relaxed;
    std::string_view sad;
};

constexpr PluginTranslations kEnglishTranslations = {
    "Smart Mix compatible tracks",
    "Show compatible tracks",
    "Open in Crate",
    "Playlists",
    "Genres",
    "Moods",
    "Recently Played",
    "Aggressive",
    "Dark",
    "Happy",
    "Party",
    "Relaxed",
    "Sad",
};

constexpr PluginTranslations kSpanishTranslations = {
    "Pistas compatibles de Smart Mix",
    "Mostrar pistas compatibles",
    "Abrir en Crate",
    "Listas de reproducción",
    "Géneros",
    "Estados de ánimo",
    "Reproducido recientemente",
    "Agresivo",
    "Oscuro",
    "Alegre",
    "Fiesta",
    "Relajado",
    "Triste",
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

std::string catalog_folder_label(
    std::string_view folder_id,
    std::string_view fallback_name,
    std::string_view language
)
{
    constexpr std::string_view kGenrePrefix = "crate:genre:";
    constexpr std::string_view kMoodPrefix = "crate:mood:";
    const auto& translations = translations_for_language(language);
    if (folder_id == "crate:playlists") {
        return std::string(translations.playlists);
    }
    if (folder_id == "crate:genres") {
        return std::string(translations.genres);
    }
    if (folder_id == "crate:moods") {
        return std::string(translations.moods);
    }
    if (folder_id == "crate:recently-played") {
        return std::string(translations.recently_played);
    }
    if (folder_id.starts_with(kGenrePrefix)) {
        return std::string(translations.genres) + " · " +
            std::string(fallback_name);
    }
    if (folder_id.starts_with(kMoodPrefix)) {
        const std::string_view mood = folder_id.substr(kMoodPrefix.size());
        std::string_view mood_label = fallback_name;
        if (mood == "aggressive") mood_label = translations.aggressive;
        if (mood == "dark") mood_label = translations.dark;
        if (mood == "happy") mood_label = translations.happy;
        if (mood == "party") mood_label = translations.party;
        if (mood == "relaxed") mood_label = translations.relaxed;
        if (mood == "sad") mood_label = translations.sad;
        return std::string(translations.moods) + " · " + std::string(mood_label);
    }
    return std::string(fallback_name);
}

} // namespace crate::vdj
