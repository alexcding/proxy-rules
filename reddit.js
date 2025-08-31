// Surge HTTP Response Body Modifier Script
// This script walks through the JSON response and modifies NSFW settings and removes ads

function walkObject(obj) {
    // Base case: if not an object or array, return as is
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj
            .map(item => walkObject(item))
            .filter(item => item !== undefined); // Remove undefined items (deleted by ad filtering)
    }
    
    // Handle objects
    if (typeof obj === 'object') {
        // Check if this object should be filtered out (ad-related content)
        if (shouldFilterObject(obj)) {
            return undefined; // This will be filtered out in array processing
        }
        
        // Create a new object to avoid mutating the original
        const newObj = {};
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                // Handle NSFW-related fields
                if (key === 'isNsfw' && obj[key] === true) {
                    newObj[key] = false;
                } else if (key === 'isNsfwMediaBlocked' && obj[key] === true) {
                    newObj[key] = false;
                } else if (key === 'isNsfwContentShown' && obj[key] === false) {
                    newObj[key] = true;
                } 
                // Handle commentsPageAds - set to empty array
                else if (key === 'commentsPageAds' && Array.isArray(obj[key])) {
                    newObj[key] = [];
                }
                // Recursively process nested objects/arrays
                else {
                    const processedValue = walkObject(obj[key]);
                    if (processedValue !== undefined) {
                        newObj[key] = processedValue;
                    }
                }
            }
        }
        
        return newObj;
    }
    
    // Return primitive values as is
    return obj;
}

function shouldFilterObject(obj) {
    // Filter objects with __typename === "AdPost"
    if (obj.__typename === "AdPost") {
        return true;
    }
    
    // Filter objects where node.adPayload is an object
    if (obj.node && 
        typeof obj.node === 'object' && 
        obj.node.adPayload && 
        typeof obj.node.adPayload === 'object') {
        return true;
    }
    
    // Filter objects where node.cells contains AdMetadataCell or isAdPost
    if (obj.node && 
        typeof obj.node === 'object' && 
        Array.isArray(obj.node.cells)) {
        
        const hasAdCell = obj.node.cells.some(cell => {
            if (typeof cell === 'object' && cell !== null) {
                return cell.__typename === "AdMetadataCell" || cell.isAdPost === true;
            }
            return false;
        });
        
        if (hasAdCell) {
            return true;
        }
    }
    
    return false;
}

// Main Surge script handler
let body = $response.body;

try {
    // Parse the JSON response
    let jsonData = JSON.parse(body);
    
    // Process the data through our walk function
    let modifiedData = walkObject(jsonData);
    
    // Convert back to JSON string
    body = JSON.stringify(modifiedData);
    
} catch (error) {
    // If parsing fails, log error and return original body
    console.log("Error processing response: " + error.message);
}

// Return the modified response
$done({ body });