#pragma once

#include <cstdio>
#include <cstdlib>

#define CRATE_CHECK(condition)                                                \
    do {                                                                      \
        if (!(condition)) {                                                   \
            std::fprintf(                                                     \
                stderr,                                                       \
                "%s:%d: check failed: %s\n",                                  \
                __FILE__,                                                     \
                __LINE__,                                                     \
                #condition                                                    \
            );                                                                \
            std::exit(EXIT_FAILURE);                                          \
        }                                                                     \
    } while (false)
