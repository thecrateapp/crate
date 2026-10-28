# Crate Hermes agent: the pinned upstream gateway plus Crate's reviewed runtime,
# operator package and the release context exported from the same commit.
# Build from the repository root after exporting the context:
#   python3 scripts/hermes_context.py --repo . --revision "$(git rev-parse HEAD)" \
#     --deployment-manifest <(printf '{"release_sha": "%s"}' "$(git rev-parse HEAD)") \
#     --destination build/hermes-context
#   docker build -f deploy/hermes/Dockerfile .
FROM nousresearch/hermes-agent:v0.22.2@sha256:36099926da316742423544e055d4734777105ffe6341873af5459b957d0c2919

COPY deploy/hermes/ /opt/crate-hermes/
COPY deploy/operator/ /opt/crate-operator/deploy/operator/
COPY scripts/release_manifest.py /opt/crate-operator/scripts/release_manifest.py
COPY build/hermes-context/ /opt/crate-hermes-context/active/

CMD ["python3", "/opt/crate-hermes/runtime.py"]
