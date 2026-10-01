{{- define "organator-cloud.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "organator-cloud.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Labels comuns. Uso: include "organator-cloud.labels" (dict "ctx" . "component" "control-plane-api") */}}
{{- define "organator-cloud.labels" -}}
app.kubernetes.io/name: {{ include "organator-cloud.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/version: {{ .ctx.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
app.kubernetes.io/component: {{ .component }}
helm.sh/chart: {{ printf "%s-%s" .ctx.Chart.Name .ctx.Chart.Version }}
{{- end }}

{{- define "organator-cloud.selectorLabels" -}}
app.kubernetes.io/name: {{ include "organator-cloud.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Imagem com tag padrão = appVersion. Uso: include "organator-cloud.image" (dict "ctx" . "image" .Values.x.image) */}}
{{- define "organator-cloud.image" -}}
{{- printf "%s:%s" .image.repository (default .ctx.Chart.AppVersion .image.tag) }}
{{- end }}

{{/* Nomes gerados pelos subcharts Bitnami (<release>-postgresql / <release>-redis-master). */}}
{{- define "organator-cloud.postgresql.fullname" -}}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "organator-cloud.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis-master" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- required "externalRedis.host é obrigatório com redis.enabled=false" .Values.externalRedis.host }}
{{- end }}
{{- end }}

{{- define "organator-cloud.redis.port" -}}
{{- if .Values.redis.enabled }}6379{{ else }}{{ .Values.externalRedis.port }}{{ end }}
{{- end }}

{{/* DATABASE_URL: do Secret do subchart (senha) ou de um Secret externo. */}}
{{- define "organator-cloud.databaseEnv" -}}
{{- if .Values.postgresql.enabled }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "organator-cloud.postgresql.fullname" . }}
      key: postgres-password
- name: DATABASE_URL
  value: "postgresql://postgres:$(POSTGRES_PASSWORD)@{{ include "organator-cloud.postgresql.fullname" . }}:5432/{{ .Values.postgresql.auth.database }}?schema=public"
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ required "externalDatabase.existingSecret é obrigatório com postgresql.enabled=false" .Values.externalDatabase.existingSecret }}
      key: {{ .Values.externalDatabase.existingSecretKey }}
{{- end }}
{{- end }}

{{- define "organator-cloud.redisEnv" -}}
- name: REDIS_HOST
  value: {{ include "organator-cloud.redis.host" . | quote }}
- name: REDIS_PORT
  value: {{ include "organator-cloud.redis.port" . | quote }}
{{- end }}

{{/* Uso: include "organator-cloud.secretEnv" (dict "ctx" . "key" "JWT_SECRET") */}}
{{- define "organator-cloud.secretEnv" -}}
- name: {{ .key }}
  valueFrom:
    secretKeyRef:
      name: {{ required "existingSecret é obrigatório (veja values.yaml)" .ctx.Values.existingSecret }}
      key: {{ .key }}
{{- end }}
