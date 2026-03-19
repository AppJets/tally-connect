$xml = @"
<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>ListOfCompanies</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="ListOfCompanies">
<TYPE>Company</TYPE>
<FETCH>Name,GUID</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>
"@

Write-Host "Sending request to Tally..."
try {
    $response = Invoke-WebRequest -Uri 'http://localhost:9000' -Method Post -ContentType 'text/xml' -Body $xml -TimeoutSec 10
    Write-Host "Response Status: $($response.StatusCode)"
    Write-Host "Response Content:"
    Write-Host $response.Content
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
