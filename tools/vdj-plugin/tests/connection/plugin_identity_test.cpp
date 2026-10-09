#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/version.hpp"

#include "../support/check.hpp"

using namespace crate::vdj;

int main()
{
    CRATE_CHECK(kPluginName == "Crate");
    CRATE_CHECK(kCredentialService == "org.cratemusic.virtualdj");
}
