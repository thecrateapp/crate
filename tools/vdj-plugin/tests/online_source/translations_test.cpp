#include "crate_vdj/translations.hpp"

#include "../support/check.hpp"
#include <string_view>

using crate::vdj::catalog_folder_label;
using crate::vdj::compatible_folder_label;
using crate::vdj::compatible_menu_label;
using crate::vdj::is_spanish_language;
using crate::vdj::open_in_crate_menu_label;

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
