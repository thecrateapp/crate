#include "crate_vdj/translations.hpp"

#include <cassert>
#include <string_view>

using crate::vdj::catalog_folder_label;
using crate::vdj::compatible_folder_label;
using crate::vdj::compatible_menu_label;
using crate::vdj::is_spanish_language;
using crate::vdj::open_in_crate_menu_label;

int main()
{
    assert(is_spanish_language("Spanish"));
    assert(is_spanish_language("es-ES"));
    assert(is_spanish_language("Español"));
    assert(!is_spanish_language("English"));

    assert(compatible_folder_label("Spanish") ==
           "Pistas compatibles de Smart Mix");
    assert(compatible_menu_label("Spanish") == "Mostrar pistas compatibles");
    assert(open_in_crate_menu_label("Spanish") == "Abrir en Crate");

    assert(catalog_folder_label(
               "crate:recently-played", "Recently Played", "Spanish"
           ) == "Reproducido recientemente");
    assert(catalog_folder_label("crate:playlist:3", "Warmup", "Spanish") ==
           "Warmup");
    assert(catalog_folder_label("crate:genre:7", "post-hardcore", "Spanish") ==
           "Géneros · post-hardcore");
    assert(catalog_folder_label("crate:genre:7", "post-hardcore", "English") ==
           "Genres · post-hardcore");
    assert(catalog_folder_label("crate:mood:happy", "Happy", "Spanish") ==
           "Estados de ánimo · Alegre");
    assert(catalog_folder_label("crate:mood:party", "Party", "English") ==
           "Moods · Party");
    assert(catalog_folder_label("crate:mood:unknown", "Unknown", "Spanish") ==
           "Estados de ánimo · Unknown");
    assert(catalog_folder_label("crate:unknown", "Server label", "Spanish") ==
           "Server label");

    return 0;
}
