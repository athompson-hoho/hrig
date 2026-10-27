param([Parameter(Mandatory=$true)][string]$TargetFile,[Parameter(Mandatory=$true)][string]$PublisherName)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $TargetFile
if ($signature.Status -ne 'Valid') { throw 'The Windows signature is not valid.' }
$publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
if ($publisher -ne $PublisherName) { throw 'The Windows publisher does not match the release policy.' }
Write-Output 'Verified Windows application publisher.'
