# aws-cli-playgarden-claude

Proyecto de trabajo para **revisar y documentar la arquitectura AWS de Playgarden** usando Claude Code junto con el AWS CLI.

## Propósito

Servir como entorno local aislado para explorar la infraestructura AWS de Playgarden (ECS, Lambdas, S3, RDS, Video on Demand, pipelines, etc.) de forma **segura y de solo lectura**, asistido por Claude Code.

## Estructura

```
.
├── .aws/               # Config local del CLI (IGNORADO por git)
│   ├── config          # Perfil 'claude-readonly' apuntando a us-east-1
│   └── credentials     # Access keys del usuario IAM claude-readonly
├── .claude/
│   └── settings.json   # Fuerza a Claude Code a usar el perfil read-only
├── .gitignore
└── README.md
```

## Acceso AWS

Todas las operaciones se ejecutan con el usuario IAM **`claude-readonly`** (cuenta `318730995815`), cuyos permisos están restringidos intencionalmente para que no se pueda modificar ningún recurso.

```bash
aws sts get-caller-identity
# Arn: arn:aws:iam::318730995815:user/claude-readonly
```

El archivo `.claude/settings.json` fuerza el uso de este perfil automáticamente dentro del proyecto:

```json
{
  "env": {
    "AWS_PROFILE": "claude-readonly",
    "AWS_CONFIG_FILE": ".../.aws/config",
    "AWS_SHARED_CREDENTIALS_FILE": ".../.aws/credentials"
  }
}
```

## Uso típico

1. Abrir el proyecto con Claude Code.
2. Pedirle a Claude que explore, describa o audite áreas específicas de la arquitectura, por ejemplo:
   - "Describe los stacks ECS de Playgarden en los 3 ambientes."
   - "Lista las Lambdas relacionadas con crons y lo que hace cada una."
   - "Revisa la configuración del pipeline de video on demand."
3. Claude responde ejecutando comandos read-only del AWS CLI.

## Seguridad

- El directorio `.aws/` contiene credenciales y **nunca** se sube al repositorio (ver `.gitignore`).
- El usuario IAM no tiene permisos de escritura en ningún servicio relevante.
- No commitear archivos que contengan access keys, secret keys, tokens, ni dumps de BD.
