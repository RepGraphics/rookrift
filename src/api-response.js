function responseError(response) {
 const status=Number(response.status)||0;
 if(status===401)return 'Your session has expired. Sign in again.';
 if(status===403)return 'You do not have permission to perform this action. Refresh the page and check your access.';
 if(status===429)return 'Too many requests. Please wait before trying again.';
 if([502,503,504].includes(status))return `The service or its proxy is unavailable (HTTP ${status}). Check the connection and server status before trying again.`;
 return status>=400?`The server could not complete this request (HTTP ${status}). Please try again later.`:'The server returned an unexpected response instead of JSON. Check the deployment URL and proxy configuration.';
}

export async function apiResponse(response,fallback='Request failed.') {
 let data;
 try{data=await response.json();}catch{throw Object.assign(new Error(responseError(response)),{status:Number(response.status)||0});}
 if(!data||typeof data!=='object')throw Object.assign(new Error(responseError(response)),{status:Number(response.status)||0});
 if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error.slice(0,500):fallback),{status:Number(response.status)||0});
 return data;
}
