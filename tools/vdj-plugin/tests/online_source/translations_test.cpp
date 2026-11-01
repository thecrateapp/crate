#include "crate_vdj/translations.hpp"

#include "../support/check.hpp"
#include <string_view>

using crate::vdj::catalog_folder_label;
using crate::vdj::compatible_folder_label;
using crate::vdj::compatible_menu_label;
using crate::vdj::is_spanish_language;
using crate::vdj::open_in_crate_menu_label;
using crate::vdj::artist_menu_label;
using crate::vdj::album_menu_label;
using crate::vdj::energy_label;
using crate::vdj::match_label;
using crate::vdj::no_profile_notice_label;

int main()
{
    CRATE_CHECK(is_spanish_language("Spanish"));
    CRATE_CHECK(is_spanish_language("es-ES"));
    CRATE_CHECK(is_spanish_language("Español"));
    CRATE_CHECK(!is_spanish_language("English"));

    CRATE_CHECK(compatible_folder_label("Spanish") ==
           "Pistas compatibles de Smart Mix");
    CRATE_CHECK(compatible_menu_label("Spanish") == "Mostrar pistas compatibles");
    CRATE_CHECK(open_in_crate_menu_label("Spanish") == "Abrir en Crate");
    CRATE_CHECK(artist_menu_label("Spanish") == "Más de este artista");
    CRATE_CHECK(album_menu_label("Spanish") == "Este álbum");
    CRATE_CHECK(artist_menu_label("English") == "More from this artist");
    CRATE_CHECK(album_menu_label("English") == "This album");
    CRATE_CHECK(energy_label("Spanish") == "Energía");
    CRATE_CHECK(match_label("Spanish") == "Encaje");
    CRATE_CHECK(no_profile_notice_label("Spanish") == "Esta pista aún no tiene perfil de Smart Mix");
    CRATE_CHECK(no_profile_notice_label("English") == "This track has no Smart Mix profile yet");

    CRATE_CHECK(catalog_folder_label(
               "crate:recently-played", "Recently Played", "Spanish"
           ) == "Reproducido recientemente");
    CRATE_CHECK(catalog_folder_label("crate:playlist:3", "Warmup", "Spanish") ==
           "Warmup");
    CRATE_CHECK(catalog_folder_label("crate:genre:7", "post-hardcore", "Spanish") ==
           "Géneros · post-hardcore");
    CRATE_CHECK(catalog_folder_label("crate:genre:7", "post-hardcore", "English") ==
           "Genres · post-hardcore");
    CRATE_CHECK(catalog_folder_label("crate:mood:happy", "Happy", "Spanish") ==
           "Estados de ánimo · Alegre");
    CRATE_CHECK(catalog_folder_label("crate:mood:party", "Party", "English") ==
           "Moods · Party");
    CRATE_CHECK(catalog_folder_label("crate:mood:unknown", "Unknown", "Spanish") ==
           "Estados de ánimo · Unknown");
    CRATE_CHECK(catalog_folder_label("crate:unknown", "Server label", "Spanish") ==
           "Server label");

    return 0;
}
