{{- define "aicser.labels" -}}
app.kubernetes.io/part-of: aicser
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Server and worker run the same image with the same settings and secrets. */}}
{{- define "aicser.serverEnv" -}}
{{- range $key, $value := .Values.server.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}

{{- define "aicser.serverEnvFrom" -}}
{{- if .Values.server.existingSecret }}
- secretRef:
    name: {{ .Values.server.existingSecret }}
{{- end }}
{{- end -}}

{{- define "aicser.sharedVolumeMounts" -}}
{{- if .Values.persistence.enabled }}
{{- range .Values.persistence.mounts }}
- name: shared-data
  mountPath: {{ .mountPath }}
  subPath: {{ .subPath }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "aicser.sharedVolumes" -}}
{{- if .Values.persistence.enabled }}
- name: shared-data
  persistentVolumeClaim:
    claimName: {{ required "persistence.existingClaim is required when persistence is enabled" .Values.persistence.existingClaim }}
{{- end }}
{{- end -}}
