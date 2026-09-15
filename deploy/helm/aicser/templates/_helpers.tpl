{{- define "aicser.labels" -}}
app.kubernetes.io/part-of: aicser
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
